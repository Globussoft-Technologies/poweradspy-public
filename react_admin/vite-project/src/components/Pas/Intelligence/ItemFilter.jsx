import React, { useState, useEffect } from "react";
import { authFetch, requireAuthOrRedirect } from "./authFetch";

const NODE_API = (import.meta.env.VITE_NODE_USER_ACTIVITY_API ?? "").trim().replace(/\/$/, "");

const ItemFilter = ({ typeTab, onFilterApply }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Map tab to API type
  const getApiType = () => {
    if (typeTab === "keywords") return "1";
    if (typeTab === "advertisers") return "2";
    if (typeTab === "domains") return "3";
    return "1";
  };

  // Fetch items list when typeTab changes
  useEffect(() => {
    const fetchItems = async () => {
      if (!NODE_API) return;
      setLoading(true);
      setSelectedItem(null);
      setSearchTerm("");
      try {
        if (!requireAuthOrRedirect()) return;
        const type = getApiType();
        const res = await authFetch(`${NODE_API}/intelligence/items-list?type=${type}`);
        const json = await res.json();
        if (json.code === 200 && json.data?.items) {
          setItems(json.data.items.filter((item) => item && item.value));
        } else {
          setItems([]);
        }
      } catch (error) {
        console.error("Error fetching items:", error);
        setItems([]);
      } finally {
        setLoading(false);
      }
    };

    fetchItems();
  }, [typeTab]);

  // Filter items based on search term
  const filteredItems = items.filter((item) =>
    item?.value && (item.value || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Handle item selection
  const handleSelectItem = (item) => {
    setSelectedItem(item);
    setDropdownOpen(false);
    setSearchTerm("");
    if (onFilterApply) {
      onFilterApply(item.value);
    }
  };

  // Clear filter
  const handleClearFilter = () => {
    setSelectedItem(null);
    setSearchTerm("");
    if (onFilterApply) {
      onFilterApply(null);
    }
  };

  return (
    <div className="relative inline-block w-full max-w-sm">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm text-left text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <div className="flex items-center justify-between">
              <span>
                {selectedItem ? selectedItem.value : `Select ${typeTab}...`}
              </span>
              <svg
                className={`w-4 h-4 transition-transform ${
                  dropdownOpen ? "transform rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
            </div>
          </button>

          {dropdownOpen && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg">
              <div className="p-2 border-b border-gray-200">
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
              </div>

              {loading ? (
                <div className="px-4 py-2 text-sm text-gray-500">Loading...</div>
              ) : filteredItems.length === 0 ? (
                <div className="px-4 py-2 text-sm text-gray-500">No items found</div>
              ) : (
                <ul className="max-h-60 overflow-y-auto">
                  {filteredItems.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => handleSelectItem(item)}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-between"
                      >
                        <span>{item.value}</span>
                        <span className="text-xs text-gray-400">
                          {item.count || 0}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {selectedItem && (
          <button
            onClick={handleClearFilter}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
            title="Clear filter"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};

export default ItemFilter;
