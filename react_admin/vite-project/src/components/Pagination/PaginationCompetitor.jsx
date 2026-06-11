import { useState } from "react";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";
const PaginationCompetitor = ({ totalCount, pageSize, setPageSize, pageIndex, setPageIndex }) => {
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="flex items-center justify-end space-x-2 m-3 w-full">
      <div className="flex items-center space-x-2">
        <span className="hidden md:block text-sm text-gray-600 ">
          Page {pageIndex + 1} of {totalPages}
        </span>
        <button
          className="p-2 rounded-full text-gray-500 disabled:opacity-50 hover:bg-gray-200 "
          onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
          disabled={pageIndex === 0}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          className="p-2 rounded-full text-gray-500 disabled:opacity-50 hover:bg-gray-200"
          onClick={() => setPageIndex((prev) => Math.min(prev + 1, totalPages - 1))}
          disabled={pageIndex >= totalPages - 1}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default PaginationCompetitor;
