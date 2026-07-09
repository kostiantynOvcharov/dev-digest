#!/usr/bin/env python3
"""
collect_metrics.py — deterministic metric extraction for /workflow-retro.

Reads the current Claude Code session transcript plus any subagent / workflow
agent transcripts it left behind, and prints a JSON blob of quantitative
metrics (tokens, cost, cache efficiency, parallelism, per-agent breakdown,
launch order, tool-call taxonomy, context duplication). The skill turns that
JSON into a human retro; it never eyeballs the raw jsonl.

Usage:
  collect_metrics.py                         # newest session for the cwd project
  collect_metrics.py --session <id-or-path>  # a specific session
  collect_metrics.py --workflow-dir <dir>    # also fold in a Workflow() transcript dir
  collect_metrics.py --since <ISO8601>       # only count main-loop turns at/after this time

Prices are best-effort defaults (per MTok, USD) — verify current numbers with
the claude-api skill. Override with --prices <json-file>.
"""
import argparse
import glob
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime

# per-MTok USD: [input, output]. cache read = 0.1x input; write 5m = 1.25x, 1h = 2x.
DEFAULT_PRICES = {
    "claude-opus-4-8": [5.0, 25.0],
    "claude-opus-4-7": [5.0, 25.0],
    "claude-sonnet-5": [3.0, 15.0],
    "claude-sonnet-4-6": [3.0, 15.0],
    "claude-haiku-4-5": [1.0, 5.0],
    "claude-fable-5": [10.0, 50.0],
}
PRICES_AS_OF = "2026-06-24 (claude-api cache)"


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def project_dir_for_cwd():
    slug = os.getcwd().replace("/", "-")
    return os.path.expanduser(f"~/.claude/projects/{slug}")


def newest_session_jsonl(proj_dir):
    files = [f for f in glob.glob(os.path.join(proj_dir, "*.jsonl"))]
    if not files:
        return None
    return max(files, key=os.path.getmtime)


def cost_for(model, usage, prices):
    p = prices.get(model)
    if not p:
        # unknown model: fall back to opus-tier so cost is never silently 0
        p = prices.get("claude-opus-4-8", [5.0, 25.0])
    pin, pout = p[0] / 1e6, p[1] / 1e6
    cc = usage.get("cache_creation", {}) or {}
    w5 = cc.get("ephemeral_5m_input_tokens", 0)
    w1 = cc.get("ephemeral_1h_input_tokens", 0)
    if not (w5 or w1):
        # older shape without the split — treat all creation as 5m
        w5 = usage.get("cache_creation_input_tokens", 0)
    return (
        usage.get("input_tokens", 0) * pin
        + usage.get("output_tokens", 0) * pout
        + usage.get("cache_read_input_tokens", 0) * pin * 0.1
        + w5 * pin * 1.25
        + w1 * pin * 2.0
    )


def scan_transcript(path, prices, since=None):
    """Aggregate one jsonl transcript (main session or one agent)."""
    agg = {
        "input": 0, "output": 0, "cache_read": 0, "cache_creation": 0,
        "assistant_turns": 0, "cost_usd": 0.0,
        "tools": Counter(), "reads": Counter(),
        "tool_errors": 0, "model": None,
        "first_ts": None, "last_ts": None,
        # launch order of Agent/Task/Workflow tool_use blocks (main loop only)
        "spawns": [],
    }
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = parse_ts(d.get("timestamp"))
        if since and ts and ts < since:
            continue
        t = d.get("type")
        if t == "assistant":
            m = d.get("message", {})
            u = m.get("usage", {}) or {}
            agg["assistant_turns"] += 1
            agg["input"] += u.get("input_tokens", 0)
            agg["output"] += u.get("output_tokens", 0)
            agg["cache_read"] += u.get("cache_read_input_tokens", 0)
            agg["cache_creation"] += u.get("cache_creation_input_tokens", 0)
            if m.get("model"):
                agg["model"] = m["model"]
                agg["cost_usd"] += cost_for(m["model"], u, prices)
            for c in m.get("content", []) or []:
                if isinstance(c, dict) and c.get("type") == "tool_use":
                    name = c.get("name", "?")
                    agg["tools"][name] += 1
                    if name == "Read":
                        fp = (c.get("input") or {}).get("file_path")
                        if fp:
                            agg["reads"][fp] += 1
                    if name in ("Agent", "Task", "Workflow"):
                        agg["spawns"].append({
                            "tool_use_id": c.get("id"),
                            "name": name,
                            "ts": d.get("timestamp"),
                            "desc": (c.get("input") or {}).get("description")
                            or (c.get("input") or {}).get("subagent_type"),
                        })
        elif t == "user":
            # tool_result blocks carrying is_error
            m = d.get("message", {})
            for c in (m.get("content", []) if isinstance(m, dict) else []) or []:
                if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("is_error"):
                    agg["tool_errors"] += 1
        if ts:
            if agg["first_ts"] is None:
                agg["first_ts"] = ts
            agg["last_ts"] = ts
    return agg


def cache_eff(a):
    denom = a["input"] + a["cache_read"] + a["cache_creation"]
    return round(a["cache_read"] / denom, 3) if denom else None


def duration_s(a):
    if a["first_ts"] and a["last_ts"]:
        return round((a["last_ts"] - a["first_ts"]).total_seconds(), 1)
    return None


def collect_agents(agent_files, prices, spawn_index):
    """agent_files: list of (jsonl_path, meta_dict). Returns per-agent records."""
    agents = []
    for jsonl_path, meta in agent_files:
        a = scan_transcript(jsonl_path, prices)
        rec = {
            "agent_type": meta.get("agentType") or meta.get("agent_type"),
            "description": meta.get("description"),
            "spawn_depth": meta.get("spawnDepth"),
            "model": a["model"],
            "tokens": {
                "input": a["input"], "output": a["output"],
                "cache_read": a["cache_read"], "cache_creation": a["cache_creation"],
            },
            "cache_efficiency": cache_eff(a),
            "cost_usd": round(a["cost_usd"], 4),
            "assistant_turns": a["assistant_turns"],
            "tool_calls_total": sum(a["tools"].values()),
            "tool_calls": dict(a["tools"].most_common()),
            "tool_errors": a["tool_errors"],
            "duration_s": duration_s(a),
            "files_read": sorted(a["reads"]),
            "first_ts": a["first_ts"].isoformat() if a["first_ts"] else None,
            "last_ts": a["last_ts"].isoformat() if a["last_ts"] else None,
        }
        tuid = meta.get("toolUseId")
        rec["launch_order"] = spawn_index.get(tuid)
        agents.append(rec)
    # order: by launch_order when known, else by first_ts
    agents.sort(key=lambda r: (r["launch_order"] is None, r["launch_order"],
                               r["first_ts"] or ""))
    return agents


def subagent_files(session_jsonl):
    """Find <session>/subagents/agent-*.jsonl + matching .meta.json."""
    base = session_jsonl[:-6] if session_jsonl.endswith(".jsonl") else session_jsonl
    sub = os.path.join(base, "subagents")
    out = []
    for jf in sorted(glob.glob(os.path.join(sub, "agent-*.jsonl"))):
        mf = jf[:-6] + ".meta.json"
        meta = {}
        if os.path.exists(mf):
            try:
                meta = json.load(open(mf, encoding="utf-8"))
            except json.JSONDecodeError:
                pass
        out.append((jf, meta))
    return out


def workflow_files(wf_dir):
    out = []
    for jf in sorted(glob.glob(os.path.join(wf_dir, "agent-*.jsonl"))):
        mf = jf[:-6] + ".meta.json"
        meta = {}
        if os.path.exists(mf):
            try:
                meta = json.load(open(mf, encoding="utf-8"))
            except json.JSONDecodeError:
                pass
        out.append((jf, meta))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", help="session id or path to <id>.jsonl")
    ap.add_argument("--workflow-dir", action="append", default=[],
                    help="a Workflow() transcript dir (repeatable)")
    ap.add_argument("--since", help="ISO8601: only main-loop turns at/after this")
    ap.add_argument("--prices", help="json file overriding the price table")
    args = ap.parse_args()

    prices = dict(DEFAULT_PRICES)
    if args.prices:
        prices.update(json.load(open(args.prices)))

    proj = project_dir_for_cwd()
    if args.session and os.path.sep in args.session:
        session_jsonl = args.session
    elif args.session:
        session_jsonl = os.path.join(proj, f"{args.session}.jsonl")
    else:
        session_jsonl = newest_session_jsonl(proj)
    if not session_jsonl or not os.path.exists(session_jsonl):
        print(json.dumps({"error": f"no session transcript found (project dir: {proj})"}))
        sys.exit(1)

    since = parse_ts(args.since) if args.since else None
    main_agg = scan_transcript(session_jsonl, prices, since=since)

    # map tool_use id -> launch order index (chronological)
    spawns = sorted(main_agg["spawns"], key=lambda s: s["ts"] or "")
    spawn_index = {s["tool_use_id"]: i + 1 for i, s in enumerate(spawns) if s.get("tool_use_id")}

    agent_files = subagent_files(session_jsonl)
    for wf in args.workflow_dir:
        agent_files += workflow_files(wf)
    agents = collect_agents(agent_files, prices, spawn_index)

    # parallelism factor: sum(agent durations) / wall-clock span of the agent phase
    spans = [(a["first_ts"], a["last_ts"]) for a in agents if a["first_ts"] and a["last_ts"]]
    parallelism = None
    critical_path = None
    if spans:
        starts = [parse_ts(s) for s, _ in spans]
        ends = [parse_ts(e) for _, e in spans]
        wall = (max(ends) - min(starts)).total_seconds()
        total = sum(a["duration_s"] or 0 for a in agents)
        parallelism = round(total / wall, 2) if wall > 0 else None
        slowest = max((a for a in agents if a["duration_s"]),
                      key=lambda a: a["duration_s"], default=None)
        if slowest:
            critical_path = {
                "description": slowest["description"],
                "agent_type": slowest["agent_type"],
                "duration_s": slowest["duration_s"],
            }

    # context duplication: files read by >1 agent
    read_by = defaultdict(list)
    for a in agents:
        for f in a["files_read"]:
            read_by[f].append(a["description"] or a["agent_type"] or "?")
    dup_reads = {f: readers for f, readers in read_by.items() if len(readers) > 1}

    grand_cost = round(main_agg["cost_usd"] + sum(a["cost_usd"] for a in agents), 4)

    out = {
        "session_transcript": session_jsonl,
        "prices_as_of": PRICES_AS_OF,
        "since": since.isoformat() if since else None,
        "main_loop": {
            "model": main_agg["model"],
            "tokens": {
                "input": main_agg["input"], "output": main_agg["output"],
                "cache_read": main_agg["cache_read"],
                "cache_creation": main_agg["cache_creation"],
            },
            "cache_efficiency": cache_eff(main_agg),
            "cost_usd": round(main_agg["cost_usd"], 4),
            "assistant_turns": main_agg["assistant_turns"],
            "tool_calls_total": sum(main_agg["tools"].values()),
            "tool_calls": dict(main_agg["tools"].most_common()),
            "tool_errors": main_agg["tool_errors"],
            "duration_s": duration_s(main_agg),
        },
        "agents_count": len(agents),
        "agents": agents,
        "launch_order": [
            {"order": i + 1, "name": s["name"], "desc": s.get("desc"), "ts": s["ts"]}
            for i, s in enumerate(spawns)
        ],
        "parallelism_factor": parallelism,
        "critical_path": critical_path,
        "context_duplication": dup_reads,
        "totals": {
            "cost_usd": grand_cost,
            "agents": len(agents),
            "tool_errors": main_agg["tool_errors"] + sum(a["tool_errors"] for a in agents),
        },
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
