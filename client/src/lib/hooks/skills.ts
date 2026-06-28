/* hooks/skills.ts — React Query hooks for the Skills page + Skill editor.
   Mirrors hooks/agents.ts. All requests go through src/lib/api.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Agent,
  Skill,
  SkillImportPreview,
  SkillSource,
  SkillType,
  SkillVersion,
} from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

/** Agents that link this skill (Stats tab: USED BY + agents-using list). */
export function useSkillAgents(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-agents", id],
    queryFn: () => api.get<Agent[]>(`/skills/${id}/agents`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<
    Pick<Skill, "name" | "description" | "type" | "body" | "enabled" | "evidence_files">
  >;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

export interface ImportSkillInput {
  filename: string;
  content_base64: string;
}

/** Parse-only preview of an uploaded .md/.zip — never persists or executes. */
export function useImportSkillPreview() {
  return useMutation({
    mutationFn: (input: ImportSkillInput) =>
      api.post<SkillImportPreview>("/skills/import", input),
  });
}
