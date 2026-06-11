import { useState } from "react";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";

const Pagination = ({ totalCount, pageSize, setPageSize, pageIndex, setPageIndex }) => {
  let totalPages;
  {
    pageSize ==10 ?
    totalPages = Math.ceil(totalCount / pageSize) :
    totalPages = Math.floor(totalCount / pageSize)
  }
  return (
    <div className="flex items-center justify-end space-x-2 m-3 w-full">
      {/* <div className="flex gap-2 items-center text-gray-700 dark:text-white">
        <span className="hidden md:block text-sm">Rows Per Page:</span>
        <select
          className="border px-2 py-1 rounded-md bg-white dark:bg-gray-800 dark:text-white"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPageIndex(0);
          }}
        >
          {[10, 20, 30].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div> */}

      {/* Pagination Controls */}
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
          className="p-2 rounded-full text-gray-500 disabled:opacity-50 hover:bg-gray-200 "
          onClick={() => setPageIndex((prev) => Math.min(prev + 1, totalPages - 1))}
          disabled={pageIndex === totalPages - 1}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default Pagination;