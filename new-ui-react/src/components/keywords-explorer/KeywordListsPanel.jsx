import React, { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Pencil, ChevronLeft } from "lucide-react";
import { fmtInt } from "../modals/google/GoogleIntelShared.jsx";
import {
  getGoogleKeywordLists,
  createGoogleKeywordList,
  renameGoogleKeywordList,
  deleteGoogleKeywordList,
  getGoogleKeywordListItems,
  removeGoogleKeywordFromList,
} from "../../services/api";

/** "Keyword lists" tab — user-curated named lists (create/rename/delete),
 *  drilling into one list shows its keywords joined against keyword_stats. */
const KeywordListsPanel = ({ onOpenKeyword }) => {
  const [lists, setLists] = useState(null);
  const [newName, setNewName] = useState("");
  const [activeListId, setActiveListId] = useState(null);
  const [activeList, setActiveList] = useState(null);
  const [items, setItems] = useState([]);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  const refreshLists = useCallback(async () => {
    const res = await getGoogleKeywordLists();
    setLists(res.code === 200 ? res.data?.lists || [] : []);
  }, []);

  useEffect(() => { refreshLists(); }, [refreshLists]);

  const openList = async (id) => {
    setActiveListId(id);
    const res = await getGoogleKeywordListItems({ id });
    if (res.code === 200) {
      setActiveList(res.data.list);
      setItems(res.data.keywords || []);
    }
  };

  const createList = async () => {
    if (!newName.trim()) return;
    const res = await createGoogleKeywordList({ name: newName.trim() });
    if (res.code === 200) {
      setNewName("");
      refreshLists();
    }
  };

  const submitRename = async (id) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    await renameGoogleKeywordList({ id, name: renameValue.trim() });
    setRenamingId(null);
    refreshLists();
    if (activeListId === id) openList(id);
  };

  const removeList = async (id) => {
    await deleteGoogleKeywordList({ id });
    if (activeListId === id) { setActiveListId(null); setActiveList(null); setItems([]); }
    refreshLists();
  };

  const removeItem = async (keywordId) => {
    await removeGoogleKeywordFromList({ id: activeListId, keyword_id: keywordId });
    setItems((prev) => prev.filter((i) => i.keyword_id !== keywordId));
  };

  if (activeListId) {
    return (
      <div>
        <button
          type="button"
          onClick={() => { setActiveListId(null); setActiveList(null); setItems([]); }}
          className="inline-flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text mb-3"
        >
          <ChevronLeft size={14} /> All lists
        </button>
        <h3 className="text-lg font-bold text-theme-text mb-3">{activeList?.name}</h3>
        {items.length === 0 ? (
          <div className="py-12 text-center text-sm text-theme-text-muted">No keywords in this list yet.</div>
        ) : (
          <div className="rounded-xl border border-theme-border bg-theme-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-border text-left text-[11px] uppercase tracking-wider text-theme-text-muted">
                  <th className="px-3 py-2 font-semibold">Keyword</th>
                  <th className="px-3 py-2 font-semibold">Ad Volume</th>
                  <th className="px-3 py-2 font-semibold">Competition</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.keyword_id} className="border-b border-theme-border last:border-0 hover:bg-theme-text/[0.02]">
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => onOpenKeyword?.(it.keyword)} className="text-[#6b99ff] hover:underline font-medium">
                        {it.keyword}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-theme-text">{fmtInt(it.ads_total)}</td>
                    <td className="px-3 py-2 text-theme-text">{it.competition_score ?? "–"}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => removeItem(it.keyword_id)} className="text-theme-text-muted hover:text-red-500" aria-label="Remove from list">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") createList(); }}
          placeholder="New list name"
          className="w-56 rounded-lg border border-theme-border bg-transparent px-3 py-1.5 text-sm text-theme-text focus:outline-none focus:border-[#6b99ff]/60"
        />
        <button type="button" onClick={createList} disabled={!newName.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#6b99ff] text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
          <Plus size={13} /> New list
        </button>
      </div>

      {lists === null ? (
        <div className="py-12 text-center text-sm text-theme-text-muted">Loading lists…</div>
      ) : lists.length === 0 ? (
        <div className="py-12 text-center text-sm text-theme-text-muted">No keyword lists yet — create one above, or add keywords from the Keywords tab.</div>
      ) : (
        <div className="rounded-xl border border-theme-border bg-theme-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-theme-border text-left text-[11px] uppercase tracking-wider text-theme-text-muted">
                <th className="px-3 py-2 font-semibold">List</th>
                <th className="px-3 py-2 font-semibold">Keywords</th>
                <th className="px-3 py-2 font-semibold">Last edited</th>
                <th className="px-3 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => (
                <tr key={l.id} className="border-b border-theme-border last:border-0 hover:bg-theme-text/[0.02]">
                  <td className="px-3 py-2">
                    {renamingId === l.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") submitRename(l.id); if (e.key === "Escape") setRenamingId(null); }}
                        onBlur={() => submitRename(l.id)}
                        className="rounded-md border border-theme-border bg-transparent px-2 py-1 text-sm text-theme-text"
                      />
                    ) : (
                      <button type="button" onClick={() => openList(l.id)} className="text-[#6b99ff] hover:underline font-medium text-left">
                        {l.name}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-theme-text">{fmtInt(l.keyword_count)}</td>
                  <td className="px-3 py-2 text-theme-text-muted">{new Date(l.updated_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => { setRenamingId(l.id); setRenameValue(l.name); }} className="text-theme-text-muted hover:text-theme-text" aria-label="Rename list">
                        <Pencil size={13} />
                      </button>
                      <button type="button" onClick={() => removeList(l.id)} className="text-theme-text-muted hover:text-red-500" aria-label="Delete list">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default KeywordListsPanel;
