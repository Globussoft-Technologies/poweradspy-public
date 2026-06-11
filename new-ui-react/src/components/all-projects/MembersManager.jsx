import React, { useState, useEffect, useCallback } from "react";
import { Users, Trash2, X, Plus, Mail, Check, MailCheck } from "lucide-react";
import { CompetitorAPI } from "../../services/api";

/**
 * MembersManager (NEW) — self-contained. A floating "Members" button + modal
 * that lets the user save members (name + email) and choose, per brand, which
 * members should also receive that brand's competitor email (CC).
 * See compeitetor_analysis/docs/MEMBER_CC_MANIFEST.md.
 *
 * Props:
 *   userId   — the competitor mongo user id (competitorUserId in AllProjects)
 *   projects — the user's projects [{ project_id, advertiser, ... }]
 */
// Per-brand picker — VISIBLE. Backend uses these picks to drive the new
// direct-send-to-member mail flow (manifest §13): each picked member
// receives a brand-isolated digest as the primary `to:` (no CC). An
// unassigned member receives nothing — explicit assignment is required.
const SHOW_PER_BRAND_CC = true;

export default function MembersManager({ userId, projects = [] }) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [brandCc, setBrandCc] = useState({}); // project_id -> Set(memberId)

  const ccProjects = (projects || []).filter((p) => p.project_id);

  const loadMembers = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await CompetitorAPI.listMembers(userId);
      setMembers(r?.body?.data?.members || []);
    } catch { /* ignore */ }
  }, [userId]);

  const loadBrandCc = useCallback(async () => {
    if (!userId || !ccProjects.length) { setBrandCc({}); return; }
    const map = {};
    await Promise.all(
      ccProjects.map(async (p) => {
        try {
          const r = await CompetitorAPI.getBrandCc(userId, p.project_id);
          map[p.project_id] = new Set((r?.body?.data?.member_ids || []).map(String));
        } catch { map[p.project_id] = new Set(); }
      })
    );
    setBrandCc(map);
  }, [userId, ccProjects.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    loadMembers();
    if (SHOW_PER_BRAND_CC) loadBrandCc();
  }, [open, loadMembers, loadBrandCc]);

  const addMember = async () => {
    setErr("");
    if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setErr("Enter a name and a valid email.");
      return;
    }
    setBusy(true);
    try {
      const r = await CompetitorAPI.addMember(userId, name.trim(), email.trim());
      if (r?.body?.status === "success") {
        setName(""); setEmail("");
        await loadMembers();
      } else {
        setErr(r?.body?.message || "Failed to add member.");
      }
    } catch {
      setErr("Failed to add member.");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (id) => {
    try {
      await CompetitorAPI.deleteMember(userId, id);
      await loadMembers();
      await loadBrandCc();
    } catch { /* ignore */ }
  };

  const toggleCc = async (projectId, memberId) => {
    const cur = new Set(brandCc[projectId] || []);
    const mid = String(memberId);
    if (cur.has(mid)) cur.delete(mid); else cur.add(mid);
    setBrandCc((prev) => ({ ...prev, [projectId]: cur }));
    try { await CompetitorAPI.setBrandCc(userId, projectId, [...cur]); } catch { /* ignore */ }
  };

  // Select-all / Clear-all toggle for one brand's recipients. If every
  // member is already selected → clear. Otherwise → select all of them.
  const toggleAllForBrand = async (projectId) => {
    const current = brandCc[projectId] || new Set();
    const allIds = members.map((m) => String(m._id));
    const next = current.size === allIds.length ? new Set() : new Set(allIds);
    setBrandCc((prev) => ({ ...prev, [projectId]: next }));
    try { await CompetitorAPI.setBrandCc(userId, projectId, [...next]); } catch { /* ignore */ }
  };

  if (!userId) return null;

  return (
    <>
      {/* Inline button (placed in the page header by the parent) */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-theme-card border border-theme-border hover:border-[#3759a3] text-theme-text font-bold transition-all"
        title="Manage members & competitor-email CC"
      >
        <Users size={18} /> Members
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-theme-card border border-theme-border rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-theme-border">
              <h2 className="text-xl font-bold text-theme-text flex items-center gap-2">
                <Users size={20} className="text-[#6b99ff]" /> Members
              </h2>
              <button onClick={() => setOpen(false)} className="text-theme-text-muted hover:text-theme-text">
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5 space-y-6">
              {/* Add member */}
              <div>
                <p className="text-sm font-semibold text-theme-text-secondary mb-2">Add a member</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name"
                    className="flex-1 bg-theme-bg border border-theme-border rounded-xl py-2.5 px-3 text-theme-text text-sm focus:outline-none focus:border-[#3759a3]"
                  />
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" size={16} />
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="w-full bg-theme-bg border border-theme-border rounded-xl py-2.5 pl-9 pr-3 text-theme-text text-sm focus:outline-none focus:border-[#3759a3]"
                    />
                  </div>
                  <button
                    onClick={addMember}
                    disabled={busy}
                    className="px-4 py-2.5 rounded-xl bg-[#335296] hover:bg-[#3762c1] text-white text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <Plus size={16} /> Add
                  </button>
                </div>
                {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
              </div>

              {/* Member list */}
              <div>
                <p className="text-sm font-semibold text-theme-text-secondary mb-2">Your members ({members.length})</p>
                {members.length === 0 ? (
                  <p className="text-theme-text-muted text-sm">No members yet. Add one above.</p>
                ) : (
                  <div className="space-y-1.5">
                    {members.map((m) => (
                      <div key={m._id} className="flex items-center justify-between bg-theme-bg border border-theme-border rounded-xl px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-theme-text text-sm font-medium truncate">{m.name}</p>
                          <p className="text-theme-text-muted text-xs truncate">{m.email}</p>
                        </div>
                        <button onClick={() => removeMember(m._id)} className="text-theme-text-muted hover:text-red-400 flex-shrink-0 ml-2" title="Remove">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Per-brand recipient picker. Backend (manifest §13) sends a
                  brand-isolated mail DIRECTLY to each picked member — no CC,
                  no ride-along. An unassigned member receives nothing. The
                  SHOW_PER_BRAND_CC flag at the top gates the whole section
                  in case we ever need to hide it again. */}
              {SHOW_PER_BRAND_CC && (
              <div>
                <div className="flex items-start gap-2 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-[#3762c1]/15 flex items-center justify-center flex-shrink-0">
                    <MailCheck size={18} className="text-[#6b99ff]" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-theme-text">Brand recipients</p>
                    <p className="text-theme-text-muted text-xs leading-snug">
                      Pick who should receive each brand's daily competitor
                      report. Each selected member gets their own
                      brand-focused mail directly.
                    </p>
                  </div>
                </div>

                {members.length === 0 ? (
                  <div className="text-center bg-theme-bg border border-dashed border-theme-border rounded-xl px-4 py-6">
                    <p className="text-theme-text-muted text-sm">Add a member above first, then come back to assign them to brands.</p>
                  </div>
                ) : ccProjects.length === 0 ? (
                  <div className="text-center bg-theme-bg border border-dashed border-theme-border rounded-xl px-4 py-6">
                    <p className="text-theme-text-muted text-sm">No brands found on this account.</p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ccProjects.map((p) => {
                      const selected = brandCc[p.project_id] || new Set();
                      const allSelected = members.length > 0 && selected.size === members.length;
                      return (
                        <div
                          key={p.project_id}
                          className="bg-theme-bg border border-theme-border rounded-2xl p-4 hover:border-[#3759a3]/60 transition-all flex flex-col"
                        >
                          {/* Card header — brand name + count chip */}
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div className="min-w-0">
                              <p className="text-theme-text font-bold text-[15px] capitalize truncate" title={p.advertiser}>{p.advertiser}</p>
                              {p.brand_url && (
                                <p className="text-theme-text-muted text-[11px] truncate" title={p.brand_url}>{p.brand_url}</p>
                              )}
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${
                                selected.size > 0
                                  ? "bg-[#3762c1]/20 text-[#6b99ff]"
                                  : "bg-theme-card text-theme-text-muted border border-theme-border"
                              }`}
                            >
                              {selected.size} / {members.length}
                            </span>
                          </div>

                          {/* Select-all / Clear-all toggle */}
                          <button
                            onClick={() => toggleAllForBrand(p.project_id)}
                            className="text-[11px] font-semibold text-[#6b99ff] hover:text-[#3762c1] inline-flex items-center gap-1 self-start mb-2.5"
                          >
                            <Check size={12} />
                            {allSelected ? "Clear all" : "Select all"}
                          </button>

                          {/* Member chips */}
                          <div className="flex flex-wrap gap-1.5">
                            {members.map((m) => {
                              const checked = selected.has(String(m._id));
                              return (
                                <button
                                  key={m._id}
                                  onClick={() => toggleCc(p.project_id, m._id)}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all inline-flex items-center gap-1 ${
                                    checked
                                      ? "bg-[#3762c1]/20 border-[#3762c1] text-[#6b99ff]"
                                      : "bg-transparent border-theme-border text-theme-text-muted hover:border-[#3759a3]"
                                  }`}
                                  title={m.email}
                                >
                                  {checked && <Check size={11} className="-ml-0.5" />}
                                  {m.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
