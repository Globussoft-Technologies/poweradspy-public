import React, { useEffect, useState, useRef, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchGeneratedMedia, fetchUsersWithGeneratedMedia, fetchGeneratedMediaSpendingReport } from "../store/actions/adsgptActions";
import { useParams, useNavigate } from "react-router-dom";
import SimpleDatepicker from "./SimpleDatepicker";
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  getPaginationRowModel,
} from "@tanstack/react-table";
import { CiSearch } from "react-icons/ci";

const columnHelper = createColumnHelper();

const MODEL_MAP = {
  "ADSGPT-1.0": "Imagen",
  "ADSGPT-2.0": "Nano Banana Pro",
  "ADSGPT-3.0": "OpenAI",
  "sora": "Sora 2",
  "soraPro": "Sora 2 Pro",
  "soraPro_4k": "Sora Pro 4K",
  "veo": "Veo 3",
  "veo-3.1-fast": "Veo 3.1 Fast",
  "veo_4k": "Veo 4K"
};

const MediaSkeleton = () => (
  <div className="border border-gray-100 rounded-xl p-4 shadow-sm animate-pulse">
    <div className="mb-3 flex justify-between items-center">
      <div className="h-5 w-16 bg-gray-200 rounded"></div>
      <div className="h-4 w-24 bg-gray-100 rounded"></div>
    </div>
    <div className="bg-gray-100 rounded-lg h-[200px] w-full flex items-center justify-center">
      <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    </div>
    <div className="mt-3 flex justify-end">
      <div className="h-3 w-32 bg-gray-50 rounded"></div>
    </div>
  </div>
);

const GeneratedMedia = () => {
  const { user_id } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [selectedUser, setSelectedUser] = useState(user_id || "");
  const { users, generatedMedia, loading, error, generatedMediaHasMore, spendingReport, userMediaSpending } = useSelector((state) => state.adsgpt);
  const [searchTerm, setSearchTerm] = useState("");
  const [mediaType, setMediaType] = useState("image");
  const [dateRange, setDateRange] = useState({
    from: null,
    to: null
  });

  const [page, setPage] = useState(1);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const loaderRef = useRef(null);

  useEffect(() => {
    if (!selectedUser) {
      dispatch(fetchUsersWithGeneratedMedia({ from: dateRange.from, to: dateRange.to }));
      dispatch(fetchGeneratedMediaSpendingReport({ from: dateRange.from, to: dateRange.to }));
    }
  }, [dispatch, selectedUser, dateRange]);

  // Handle URL change to update selected user
  useEffect(() => {
    if (user_id) setSelectedUser(user_id);
    else setSelectedUser("");
  }, [user_id]);

  useEffect(() => {
    if (selectedUser) {
      setPage(1);
      dispatch(
        fetchGeneratedMedia({
          userId: selectedUser,
          type: mediaType,
          from: dateRange.from,
          to: dateRange.to,
          page: 1,
          limit: 20
        })
      );
    }
  }, [selectedUser, mediaType, dateRange, dispatch]);

  // Fetch more pages when page UI state changes
  useEffect(() => {
    if (page === 1) return;
    const fetchMore = async () => {
      setIsFetchingMore(true);
      await dispatch(
        fetchGeneratedMedia({
          userId: selectedUser,
          type: mediaType,
          from: dateRange.from,
          to: dateRange.to,
          page,
          limit: 20
        })
      );
      setIsFetchingMore(false);
    };
    fetchMore();
  }, [page]);

  // IntersectionObserver to detect bottom scroll
  useEffect(() => {
    if (!loaderRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && generatedMediaHasMore && !loading && !isFetchingMore) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 1.0 }
    );
    observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [generatedMediaHasMore, loading, isFetchingMore]);

  const handleUserDetails = (userId) => {
    navigate(`/adsgpt/generated-media/${userId}`);
  };

  const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL || "https://contents.adsgpt.io";

  const renderMedia = (media) => {
    if (media.type === "image") {
      const rawSrc = media.image?.base_image_with_logo || media.image?.base_image;
      const src = typeof rawSrc === "string" ? rawSrc : null;
      if (!src) return <div className="text-gray-400 text-xs text-center py-4">No image available</div>;
      return <img src={src.startsWith("http") ? src : `${S3_BASE_URL}${src}`} alt="Adsgpt Generated" className="w-full h-auto rounded-md object-contain max-h-[300px]" />;
    } else if (media.type === "video") {
      const rawSrc = media.video;
      const src = typeof rawSrc === "string" ? rawSrc : null;
      if (!src) return <div className="text-gray-400 text-xs text-center py-4">No video available</div>;
      return (
        <video controls className="w-full h-auto rounded-md object-contain max-h-[300px]">
          <source src={src.startsWith("http") ? src : `${S3_BASE_URL}${src}`} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      );
    }
    return null;
  };

  const tableLabelsColors = [
    { bg: "#E57373", color: "#FFFFFF" }, // Red
    { bg: "#81C784", color: "#FFFFFF" }, // Green
    { bg: "#64B5F6", color: "#FFFFFF" }, // Blue
    { bg: "#FFD54F", color: "#000000" }, // Yellow
    { bg: "#BA68C8", color: "#FFFFFF" }, // Purple
  ];

   const totalAllUsersCost = useMemo(() => {
  if (!Array.isArray(spendingReport)) return 0;
  return spendingReport.reduce((sum, item) => sum + (item.userTotalCost || 0), 0);
}, [spendingReport]);


  const filteredUsers = useMemo(() => {
    const reportMap = Array.isArray(spendingReport) ? spendingReport.reduce((acc, item) => {
      acc[item.userId] = item.userTotalCost;
      return acc;
    }, {}) : {};

    return users?.map(user => ({
      ...user,
      totalCost: reportMap[user.user_id] || 0
    })).filter((user) => {
      const term = searchTerm.toLowerCase();
      return (
        user.user_name?.toLowerCase().includes(term) ||
        user.user_id?.toLowerCase().includes(term) ||
        user.user_email?.toLowerCase().includes(term)
      );
    });
  }, [searchTerm, users, spendingReport]);

  const columns = [
    columnHelper.accessor("user_id", {
      id: "user_id",
      header: "User ID",
      cell: (info) => (
        <span className="text-[#343A40] whitespace-nowrap">
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("generatedCount", {
      id: "generatedCount",
      header: "Generated Media",
      cell: (info) => (
        <span className="text-[#343A40] whitespace-nowrap">
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("totalCost", {
      id: "totalCost",
      header: "Total Cost",
      cell: (info) => (
        <span className="text-[#343A40] whitespace-nowrap">
          ${info.getValue()?.toFixed(2)}
        </span>
      ),
    }),
    columnHelper.accessor("action", {
      id: "action",
      header: "Action",
      cell: (info) => {
        const userId = info.row.original.user_id;
        return (
          <button
            className="!bg-[#Eaf0fe] !text-[#1f296a] px-3 py-1 rounded-md text-sm"
            onClick={() => handleUserDetails(userId)}
          >
            Generated Media
          </button>
        );
      },
    }),
  ];

  const table = useReactTable({
    data: filteredUsers || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
  });

  const displayedMedia = Array.isArray(generatedMedia) ? generatedMedia.filter(media => media.type === mediaType) : [];

  return (
    <div className="bg-white rounded-[10px] w-full h-[calc(100vh-120px)] p-[24px] flex flex-col">
      {!selectedUser ? (
        <>
          <div className="flex justify-between items-center mb-6 flex-shrink-0">
            <div className="flex items-center gap-4">
              <h2 className="text-[#1f296a] font-[600] text-[24px]">
                Interaction Data
              </h2>
              <div className="flex items-center gap-2 bg-[#Eaf0fe] border border-[#c7d4fd] px-4 py-1.5 rounded-lg">
                <span className="text-sm text-[#1f296a] font-medium">Total Spend:</span>
                <span className="text-sm text-[#1f296a] font-bold">
                  ${totalAllUsersCost.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <SimpleDatepicker
                initialStartDate={null}
                initialEndDate={null}
                onDateChange={(from, to) => {
                  const formatLocal = (date) => {
                    if (!date) return null;
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, "0");
                    const d = String(date.getDate()).padStart(2, "0");
                    return `${y}-${m}-${d}`;
                  };

                  const fromStr = formatLocal(from);
                  const toStr = formatLocal(to);

                  const toEndOfDay = toStr ? `${toStr}T23:59:59.999Z` : null;
                  const fromStartOfDay = fromStr ? `${fromStr}T00:00:00.000Z` : null;

                  setDateRange({ from: fromStartOfDay, to: toEndOfDay });
                }}
                setSelectedSystem={() => { }}
                setShowFilterModal={() => { }}
              />

              <div className="w-[20vw] relative h-[42px]">
                <CiSearch className="absolute left-3 top-2.5 w-5 h-5 text-[#575757]" />
                <input
                  type="text"
                  placeholder="Search by Name or ID or Email ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-3 py-2 border border-[#dee2e6] rounded-lg w-full focus:outline-[#157496] text-sm text-black"
                />
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="overflow-y-auto h-full">
              <table className="w-full border-collapse">
                <thead className="bg-[#f9f9fb] rounded-[12px] sticky top-0 bg-white">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className="table_header_class px-4 py-3 h-[53px] text-left text-13 font-medium text-[#343A40] hover:text-gray-500 whitespace-nowrap transition-all duration-100 ease-in cursor-pointer"
                        >
                          <span className="inline table_heading">
                            {header.isPlaceholder
                              ? null
                              : typeof header.column.columnDef.header === "function"
                                ? header.column.columnDef.header()
                                : header.column.columnDef.header}
                          </span>
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.length > 0 ? (
                    table.getRowModel().rows.map((row, index) => (
                      <tr
                        key={row.id}
                        className={`h-12 border-b border-border_primary border-[#dddddd] font-[400] text-[14px] !text-[#1f1f1f] hover:bg-gray-50 transition-colors cursor-pointer ${index % 2 === 0 ? "bg-white text-gray-700" : "bg-white"
                          }`}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className="px-5 py-2.5 text-13 text-left font-normal text-[#343A40]"
                          >
                            {cell.column.columnDef.cell(cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={table.getAllColumns().length}
                        className="px-4 py-8 text-sm text-center font-normal text-[#A0A0A0]"
                      >
                        No users available
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-between items-center mb-6">

            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/adsgpt/generated-media')}
                className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-md text-sm hover:bg-gray-200"
              >
                &larr; Back
              </button>

              <h2 className="text-[#1f296a] font-[600] text-[24px]">
                Generated Media
              </h2>

              <div className="flex items-center gap-2 ml-2">
                {userMediaSpending?.models
                  ?.filter((m) => {
                    const imageModels = ["ADSGPT-1.0", "ADSGPT-2.0", "ADSGPT-3.0"];
                    const videoModels = ["sora", "soraPro", "soraPro_4k", "veo", "veo-3.1-fast", "veo_4k"];
                    return mediaType === "image" ? imageModels.includes(m.model) : videoModels.includes(m.model);
                  })
                  ?.map((m, idx) => (
                    <div key={idx} className="relative group">
                      <div className="bg-[#Eaf0fe] text-[#1f296a] text-[11px] font-bold px-2.5 py-1 rounded-full cursor-pointer border border-[#c7d4fd] transition-all hover:bg-[#d0dbff]">
                        {MODEL_MAP[m.model] || m.model}
                      </div>
                      {/* Hover Tooltip */}
                      <div className="absolute left-0 top-full mt-2 w-40 p-2 bg-white border border-[#c7d4fd] rounded-lg shadow-xl z-50 hidden group-hover:block animate-in fade-in zoom-in duration-200">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1.5 border-b border-gray-100 pb-1 ">
                          {MODEL_MAP[m.model] || m.model}
                        </div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[11px] text-gray-600">Total Count</span>
                          <span className="text-[11px] font-bold text-[#1f296a] bg-blue-50 px-1.5 rounded">{m.count}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] text-gray-600">Total Spent</span>
                          <span className="text-[11px] font-bold text-green-600">${m.cost?.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>


            {/* RIGHT SIDE CONTROLS */}
            <div className="flex items-center gap-4">

              {/* DATE PICKER */}
              <SimpleDatepicker

                initialStartDate={null}
                initialEndDate={null}
                onDateChange={(from, to) => {
                  const formatLocal = (date) => {
                    if (!date) return null;
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, "0");
                    const d = String(date.getDate()).padStart(2, "0");
                    return `${y}-${m}-${d}`;
                  };

                  const fromStr = formatLocal(from);
                  const toStr = formatLocal(to);

                  // Add end of day to "to" date so it includes the full day
                  const toEndOfDay = toStr ? `${toStr}T23:59:59.999Z` : null;
                  const fromStartOfDay = fromStr ? `${fromStr}T00:00:00.000Z` : null;

                  setDateRange({ from: fromStartOfDay, to: toEndOfDay });
                }}
                setSelectedSystem={() => { }}
                setShowFilterModal={() => { }}
              />


              {/* MEDIA TYPE SWITCH */}
              <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
                <button
                  onClick={() => setMediaType("image")}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          mediaType === "image"
                      ? "bg-white shadow-sm text-blue-600"
                      : "text-gray-600 hover:text-gray-900"
                    }`}
                >
                  Generated Image
                </button>

                <button
                  onClick={() => setMediaType("video")}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          mediaType === "video"
                      ? "bg-white shadow-sm text-blue-600"
                      : "text-gray-600 hover:text-gray-900"
                    }`}
                >
                  Generated Video
                </button>
              </div>

            </div>

          </div>

          {loading && page === 1 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <MediaSkeleton key={i} />
              ))}
            </div>
          ) : error ? (
            <div className="text-center text-red-500 py-10">
              No generated media found or API Error ({error})
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {displayedMedia?.map((media) => (
                  <div key={media._id} className="border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="mb-3 flex justify-between items-center text-sm">
                      <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded capitalize">
                        {media.type}
                      </span>
                      <span className="text-gray-500 text-xs font-semibold">
                      Model: {MODEL_MAP[media.model] || media.model}
                      </span>
                    </div>
                    <div className="bg-gray-50 rounded-lg overflow-hidden flex items-center justify-center min-h-[200px]">
                      {renderMedia(media)}
                    </div>
                    <div className="mt-3 text-xs text-gray-400 text-right">
                      {new Date(media.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>

              {/* Infinite scroll loader trigger */}
              <div ref={loaderRef} className="py-10">
                {isFetchingMore ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 w-full">
                    {[...Array(4)].map((_, i) => (
                      <MediaSkeleton key={`more-${i}`} />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center">
                    {!generatedMediaHasMore && displayedMedia.length > 0 && (
                      <p className="text-gray-400 text-sm font-medium">You've reached the end of the collection</p>
                    )}
                    {displayedMedia.length === 0 && !loading && (
                      <div className="text-center text-gray-500">
                        No generated {mediaType}s found for this user.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default GeneratedMedia;
