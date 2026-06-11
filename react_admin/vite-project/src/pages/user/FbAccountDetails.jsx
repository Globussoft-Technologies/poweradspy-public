import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import FbAccountFilter from '../../components/Pas/FbAccountFilter';
import { fetchAccountDetails } from '../../store/actions/powerAdsPyActionsApi';

const columnHelper = createColumnHelper();

const FbAccountDetails = ({ isLoading }) => {
  const dispatch = useDispatch();
  const { accountData } = useSelector(state => state.poweradspy);
//   const formatDateTime = (date) => {
//     return date.toISOString().slice(0, 19).replace('T', ' ');
//   };
//   const now = new Date();
// const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const [filters, setFilters] = useState({
    dateRange: {
      startDate: null,
      endDate: null,
    },
    city: '',
    accountName: '',
    country: ''
  });

  const [page, setPage] = useState(0);
  const limit = 10;

  // Fetch data with filters & pagination
  useEffect(() => {
    const payload = {
      network: "facebook",
      fromDate: filters.dateRange.startDate,
      toDate: filters.dateRange.endDate,
      city: filters.city,
      name: filters.accountName,
      country: filters.country,
      limit,
      skip: page * limit,
    };
    dispatch(fetchAccountDetails(payload));
  }, [dispatch, filters, page]);

  // Handle filter changes
  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
    setPage(0); // Reset to first page when filters change
  };

  // Transform data
  const clientsDetails = useMemo(() => {
    return accountData.map((e) => ({
      name: e?.name || 'N/A',
      facebook_id: e?.facebook_id || 'N/A',
      facebook_profile_url: 'N/A',
      created_date: e?.created_date || 'N/A',
      country: e?.current_country || 'N/A',
      user_account: 'N/A',
      todays_count: "N/A",
      current_count: e?.ad_count || 1
    }));
  }, [accountData]); // Only recalculate when accountData changes

  const columns = useMemo(() => [
    columnHelper.accessor('name', {
      header: 'Name',
      cell: info => <span className="whitespace-nowrap">{info.getValue()}</span>,
    }),
    columnHelper.accessor('facebook_id', {
      header: 'Facebook_id',
      cell: info => <span>{info.getValue()}</span>,
    }),
    columnHelper.accessor('facebook_profile_url', {
      header: 'Facebook_profile_url',
      cell: info => (
        <a
          href={info.getValue()}
          target="_blank"
          rel="noopener noreferrer"
          className="!text-[#535353] underline break-all"
        >
          {info.getValue()}
        </a>
      ),
    }),
    columnHelper.accessor('created_date', {
      header: 'Created_date',
      cell: info => <span>{info.getValue()}</span>,
    }),
    columnHelper.accessor('country', {
      header: 'Country (region)',
      cell: info => <span>{info.getValue()}</span>,
    }),
    columnHelper.accessor('user_account', {
      header: 'User Account',
      cell: info => <span>{info.getValue()}</span>,
    }),
    columnHelper.accessor('todays_count', {
      header: "Today's Count",
      cell: info => (
        <span className="font-medium cursor-pointer hover:underline">
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor('current_count', {
      header: "Current's count",
      cell: info => (
        <span className="font-medium cursor-pointer hover:underline">
          {info.getValue()}
        </span>
      ),
    }),
  ], []);

  const table = useReactTable({
    data: clientsDetails,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // Pagination Controls
  const handlePrevious = () => setPage(prev => Math.max(prev - 1, 0));
  const handleNext = () => {
    if (clientsDetails?.length === limit) {
      setPage(prev => prev + 1);
    }
  };

  return (
    <div>
      <div className='flex justify-between'>
        <span className='font-[600] text-[30px] text-[#264688]'>FB Account Details</span>
        <FbAccountFilter onFilterChange={handleFilterChange} />
      </div>

      <div className="overflow-auto h-[620px] bg-white rounded-lg mt-[16px]">
        <table className="w-full">
          <thead className="bg-[#F1F1FF] sticky top-0 z-10">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} className="text-[#030303] font-[500] !px-[16px] !py-[12px] text-left whitespace-nowrap text-[18px] border-b border-gray-200">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map(row => (
                <tr key={row.id} className="hover:bg-gray-100">
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="text-[14px] font-[400] !px-[16px] !py-[12px] border-b border-gray-200 text-[#535353] whitespace-nowrap">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns?.length} className="text-center py-5">
                  {isLoading ? 'Loading...' : 'No data found'}
                </td>
              </tr>
            )}
          </tbody>
        </table>

              {/* Pagination Controls */}
        <div className="flex justify-center items-center gap-4 mt-4">
        <button
          onClick={handlePrevious}
          disabled={page === 0}
          className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
        >
          &lt;
        </button>
        <span>Page {page + 1}</span>
        <button
          onClick={handleNext}
          disabled={clientsDetails?.length < limit}
          className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
        >
          &gt;
        </button>
      </div>
      </div>

    </div>
  );
};
export default FbAccountDetails;