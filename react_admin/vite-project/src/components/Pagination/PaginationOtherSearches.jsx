import { useState } from "react";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";

const PaginationOtherSearches = ({ totalCount, pageSize, setPageSize, pageIndex, setPageIndex, handleNextPage, handlePrevPage }) => {
  if (!totalCount || totalCount === 0) return null;

  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  return (
    <div className="flex items-center justify-end space-x-2 m-3 w-full">
      <div className="flex items-center space-x-2">
        <span className="hidden md:block text-sm text-gray-600">
          Page {pageIndex + 1} of {totalPages}
        </span>
        <button
          className="p-2 rounded-full text-gray-500 disabled:opacity-50 hover:bg-gray-200"
          onClick={handlePrevPage}
          disabled={pageIndex === 0}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          className="p-2 rounded-full text-gray-500 disabled:opacity-50 hover:bg-gray-200"
          onClick={handleNextPage}
          disabled={pageIndex >= totalPages - 1}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default PaginationOtherSearches;