import React, { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  flexRender,
  getPaginationRowModel,
  getFilteredRowModel,
} from "@tanstack/react-table";
import SimpleDateRangePicker from "../../components/SimpleDatepicker";
import { CiSearch } from "react-icons/ci";
import Facebook from "../../assets/Social/fb.png";
import Google from "../../assets/Social/Google.png";
import Instagram from "../../assets/Social/Instagram.png";
import Youtube from "../../assets/Social/Youtube.png";
import Linkedin from "../../assets/Social/Linkedin.png";
import Quora from "../../assets/Social/Quora.png";
import Pinterest from "../../assets/Social/Pinterest.png";
import Reddit from "../../assets/Social/Reddit.png";
import Tiktok from "../../assets/Social/Tiktok.png";
import Native from "../../assets/Social/Native.png";
import Gdn from "../../assets/Social/Google-ads.png";
import { MdCancel } from "react-icons/md";

const ModalSystemInfo = ({ data, onClose,network }) => {
    const [searchTerm, setSearchTerm] = useState("");
    const [globalFilter, setGlobalFilter] = useState('');

    const getNetworkIcon = (network) => {
        const networkIcons = {
          facebook: Facebook,
          google: Google,
          instagram: Instagram,
          native: Native,
          youtube: Youtube,
          linkedin: Linkedin,
          quora: Quora,
          pinterest: Pinterest,
          reddit: Reddit,
          gdn: Gdn,
        };
      
        if (!network) return null;

        const normalizedNetwork = network.toLowerCase();
        return networkIcons[normalizedNetwork] || null;
      };

    const columns = [
        {
            header: "Accounts Name",
            accessorKey: "account",
            cell: ({ row }) => (
                <div className="flex flex-col">
                  <span>{row.original.account!==null?row.original?.account:row?.original?.account_id??"---"}</span>
                </div>
              )
        },
        // {
        //     header: "Status",
        //     accessorKey: "system",
        //     cell: ({ getValue }) => {
        //         const status = getValue();
        //         return (
        //             <span 
        //                 className={`px-2 py-1 rounded text-xs font-medium ${
        //                     status === "Active" 
        //                         ? "bg-green-100 text-green-800" 
        //                         : "bg-red-100 text-red-800"
        //                 }`}
        //             >
        //                 {status}
        //             </span>
        //         );
        //     }
        // },
        {
            header: "NetWork",
            accessorKey: "network",
            // cell: ({ getValue }) => {
            //     const adsCount = getValue();
            //     return (
            //         <span className="font-medium">
            //             {adsCount.toLocaleString()}
            //         </span>
            //     );
            // }
        },
        {
            header: "Total Ads Count",
            accessorKey: "total_ads",
            // cell: ({ getValue }) => {
            //     const adsCount = getValue();
            //     return (
            //         <span className="font-medium">
            //             {adsCount.toLocaleString()>0?adsCount.toLocaleString():"---"}
            //         </span>
            //     );
            // }
        },
        {
            header: "Unique Ads Count",
            accessorKey: "unique_ads",
            // cell: ({ getValue }) => {
            //     const adsCount = getValue();
            //     return (
            //         <span className="font-medium">
            //             {adsCount.toLocaleString()}
            //         </span>
            //     );
            // }
        },
        {
            header: "Updated Ads Count",
            accessorKey: "updated_ads",
            // cell: ({ getValue }) => {
            //     const adsCount = getValue();
            //     return (
            //         <span className="font-medium">
            //             {adsCount.toLocaleString()>0?adsCount.toLocaleString():"---"}
            //         </span>
            //     );
            // }
        },
    ];

    const table = useReactTable({
        data: data|| [],
        columns,
        initialState: {
          pagination: {
              pageSize: 6, // Set default page size to 2 items
          },
      },
        state: {
            globalFilter,
        },
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        globalFilterFn: (row, columnId, filterValue) => {
            const search = filterValue.toLowerCase();
            const value = row.getValue(columnId);
            
            if (typeof value === 'string') {
                return value.toLowerCase().includes(search);
            }
            if (typeof value === 'number') {
                return value.toString().includes(search);
            }
            return false;
        },
    });

    const handleSearch = (e) => {
        setSearchTerm(e.target.value);
        setGlobalFilter(e.target.value);
    };

    return (
        <div className="relative">
            <div className="pl-[30px] pr-[24px] flex justify-between items-center mb-[24px]">
                <div className='flex gap-[7px] items-center'>
                    <div className="w-[38px] h-[38px] border border-[#cbcbcb] rounded-[25px] py-[7px] px-[7px]">
                        <img src={getNetworkIcon(network)} alt="" className="w-full h-full" />
                    </div>
                    <p className="text-[#1f296a] font-[600] text-[24px]">
                        {network}
                    </p>
                </div>
                
                <div className="flex gap-[16px] items-center">
                    <div className="w-[20vw] relative h-[42px]">
                        <CiSearch className="absolute left-3 top-2.5 w-5 h-5 text-[#5d5d5d]" />
                        <input
                            type="text"
                            placeholder="Search by account name..."
                            value={searchTerm}
                            onChange={handleSearch}
                            className="pl-10 pr-3 py-2 border bg-white border-[#dee2e6] rounded-lg w-full focus:outline-[#157496] text-sm text-black"
                        />
                    </div>
                    {/* <SimpleDateRangePicker /> */}
                    <button 
                        className="!text-[21px] bg-white absolute top-[-40px] right-[18px] !p-0 hover:text-red-500 transition-colors"
                        onClick={onClose}
                    >
                       <MdCancel style={{ color: '#ff0000' }} className="hover:opacity-80" />
                    </button>
                </div>
            </div>

            <div className="w-full !bg-white !rounded-[10px] h-[640px] flex flex-col">
                <div className="overflow-auto w-full flex-1">
                    <table className=" min-w-full border-collapse">
                        <thead className="bg-[#f9f9fb] rounded-[12px] sticky top-0">
                            {table.getHeaderGroups().map((headerGroup) => (
                                <tr key={headerGroup.id}>
                                    {headerGroup.headers.map((header) => (
                                        <th
                                            key={header.id}
                                            className=" !pl-[30px] table_header_class !px-4 !py-3 !h-[53px] text-left text-13 font-medium text-[#343A40] hover:text-gray-500 whitespace-nowrap transition-all duration-100 ease-in cursor-pointer"
                                        >
                                            {flexRender(
                                                header.column.columnDef.header,
                                                header.getContext()
                                            )}
                                        </th>
                                    ))}
                                </tr>
                            ))}
                        </thead>
                        <tbody>
                            {table?.getRowModel()?.rows?.length > 0 ? (
                                table.getRowModel().rows.map((row, index) => (
                                    <tr
                                        key={row?.id}
                                        className={`!h-[93px] border-b border-border_primary border-[#dddddd] font-[400] text-[14px] !text-[#1f1f1f] hover:bg-table-row-hover-primary cursor-pointer ${
                                            index % 2 === 0
                                                ? "bg-[#fff] text-gray-700 "
                                                : "bg-white"
                                        }`}
                                    >
                                        {row.getVisibleCells().map((cell) => (
                                            <td
                                                key={cell.id}
                                                className=" !pl-[30px] !px-5 !py-2.5 text-13 text-left font-normal text-[#343A40]"
                                            >
                                                {flexRender(
                                                    cell.column.columnDef.cell,
                                                    cell.getContext()
                                                )}
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td
                                        colSpan={table?.getAllColumns()?.length}
                                        className="px-4 py-2.5 text-sm text-center font-normal text-[#A0A0A0]"
                                    >
                                        No accounts available
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination controls */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-700">
                            Showing{' '}
                            <span className="font-medium">
                                {table.getState().pagination.pageIndex + 1}
                            </span>{' '}
                            of{' '}
                            <span className="font-medium">
                                {table.getPageCount()}
                            </span>{' '}
                            pages
                        </span>
                        <span className="text-sm text-gray-700">
                            | {table?.getFilteredRowModel()?.rows?.length} accounts
                        </span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <button
                            className="px-3 py-1 border rounded-md text-sm font-medium disabled:opacity-50"
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                        >
                            Previous
                        </button>
                        <button
                            className="px-3 py-1 border rounded-md text-sm font-medium disabled:opacity-50"
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ModalSystemInfo;