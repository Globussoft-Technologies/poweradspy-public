import React, { useEffect, useState } from "react";
import { ListPlus, Plus, Check } from "lucide-react";
import { getGoogleKeywordLists, createGoogleKeywordList, addGoogleKeywordsToList } from "../../services/api";

/** Small dropdown: pick an existing Keyword List (or create one) and add `keywords` to it. */
const AddToListMenu = ({ keywords, onDone }) => {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open || lists !== null) return;
    getGoogleKeywordLists().then((res) => setLists(res.code === 200 ? res.data?.lists || [] : []));
  }, [open, lists]);

  const addTo = async (listId) => {
    setBusy(true);
    try {
      await addGoogleKeywordsToList({ id: listId, keywords });
      setDone(true);
      onDone?.();
      setTimeout(() => { setOpen(false); setDone(false); }, 900);
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await createGoogleKeywordList({ name: newName.trim() });
      if (res.code === 200 && res.data?.id) {
        await addGoogleKeywordsToList({ id: res.data.id, keywords });
        setDone(true);
        onDone?.();
        setNewName("");
        setTimeout(() => { setOpen(false); setDone(false); }, 900);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!keywords.length}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#6b99ff] text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
      >
        <ListPlus size={13} /> Add {keywords.length} to list
      </button>
      {open ? (
        <div className="absolute right-0 mt-1.5 w-56 rounded-lg border border-theme-border bg-theme-card shadow-xl z-20 p-2">
          {done ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-500 px-2 py-3">
              <Check size={14} /> Added.
            </div>
          ) : (
            <>
              <div className="max-h-40 overflow-y-auto">
                {lists === null ? (
                  <div className="px-2 py-2 text-xs text-theme-text-muted">Loading lists…</div>
                ) : lists.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-theme-text-muted">No lists yet.</div>
                ) : (
                  lists.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      disabled={busy}
                      onClick={() => addTo(l.id)}
                      className="w-full text-left px-2 py-1.5 rounded-md text-xs text-theme-text hover:bg-theme-text/[0.06] truncate"
                    >
                      {l.name} <span className="text-theme-text-muted">({l.keyword_count})</span>
                    </button>
                  ))
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-theme-border">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New list name"
                  className="flex-1 min-w-0 rounded-md border border-theme-border bg-transparent px-2 py-1 text-xs text-theme-text"
                />
                <button
                  type="button"
                  disabled={busy || !newName.trim()}
                  onClick={createAndAdd}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md bg-[#6b99ff]/10 text-[#6b99ff] px-2 py-1 text-xs font-semibold disabled:opacity-40"
                >
                  <Plus size={12} /> Create
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default AddToListMenu;
