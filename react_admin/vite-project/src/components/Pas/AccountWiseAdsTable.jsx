import { useState, useEffect } from 'react';
import { FiSearch } from "react-icons/fi";
import { ChevronLeft, ChevronRight } from "lucide-react";

const AccountWiseAdsTable = ({ accounts }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredAccounts, setFilteredAccounts] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5; // Number of items per page

  // Filter accounts based on search term
  useEffect(() => {
    if (accounts) {
      const filtered = accounts.filter(account =>
        account.account_name!==null ? account.account_name.toLowerCase().includes(searchTerm.toLowerCase()):account.account_id.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredAccounts(filtered);
      setCurrentPage(1); // Reset to first page when search changes
    }
  }, [searchTerm, accounts]);


  // Calculate pagination
  const totalPages = Math.ceil(filteredAccounts.length / itemsPerPage);
  const paginatedAccounts = filteredAccounts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  return (
    <div className="w-full flex flex-col">
      <div className="w-full rounded-xl border border-[#e8e8e8] bg-white shadow-sm mt-[30px]">
        {/* Header */}
        <div className="flex sm:items-center sm:justify-between pt-[17px] pb-[19px] pl-[24px] pr-[14px] sm:flex-row flex-col gap-[16px] sm:gap-0">
          <p className="!text-[17px] !font-[600] text-[#1E1B39] !pb-0">
            Account Wise Ads
          </p>
          <div className="relative h-[37px]">
            <input
              type="text"
              placeholder="Search Account Name"
              value={searchTerm}
              onChange={handleSearchChange}
              className="rounded-[9px] border border-[#e0e0e0] bg-gray-50 py-2 pr-4 pl-10 text-sm text-[#1F1F1F] focus:ring-2 focus:ring-blue-100 focus:outline-none"
            />
            <FiSearch className="absolute top-1/2 left-3 -translate-y-[12px] transform text-[23px] text-[#575757]" />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-auto w-full h-[100%]">
          <table className="min-w-full">
            <thead className="sticky top-0">
              <tr className="border-b border-gray-100 bg-[#F9F9FB] text-left">
                <th className="!px-[29px] !py-[22px] text-[16px] font-[400] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent">
                  Account Name
                </th>
                <th className="!px-[29px] !py-[22px] text-[16px] font-[400] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent">
                  Country
                </th>
                <th className="!px-[29px] !py-[22px] text-[16px] font-[400] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent">
                  Account ID
                </th>
                <th className="!px-[29px] !py-[22px] text-[16px] font-[400] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent">
                  Ads Count
                </th>
              </tr>
            </thead>
            <tbody className="text-[14px] font-[400] text-[#1F1F1F]">
              {paginatedAccounts.length > 0 ? (
                paginatedAccounts.map((account, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    <td className="!px-[29px] !py-[21px] cursor-pointer hover:text-blue-800 hover:underline whitespace-normal break-words max-w-[320px]" 
                      onClick={() => window.open(`https://www.facebook.com/profile.php?id=${account.account_id}`, '_blank')}>
                      {account.account_name!==null?account.account_name:account.account_id}
                      
                    </td>
                    <td className="!px-[29px] !py-[21px]">{account.country}</td>
                    <td className="!px-[29px] !py-[21px]">{account.account_id}</td>
                    <td className="!px-[29px] !py-[21px]">
                      {account?.total_ads?.toLocaleString()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4" className=" h-[320px] rounded-b-2xl bg-gray-200">
                    <div className="w-full h-full flex items-center justify-center">
                      No accounts found
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filteredAccounts.length > 0 && (
          <div className="mt-6 flex items-center justify-center gap-2.5 pb-4">
            <button 
              onClick={() => handlePageChange(Math.max(currentPage - 1, 1))}
              disabled={currentPage === 1}
              className="!h-[29px] !w-[36px] flex justify-center items-center !rounded-[9px] !border !border-[#cbcbcb] !text-[#1f1f1f] bg-gray-300! !p-0 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            
            {Array.from({ length: Math.min(totalPages, 3) }, (_, i) => {
              let pageNum;
              if (totalPages <= 3) {
                pageNum = i + 1;
              } else if (currentPage === 1) {
                pageNum = i + 1;
              } else if (currentPage === totalPages) {
                pageNum = totalPages - 2 + i;
              } else {
                pageNum = currentPage - 1 + i;
              }
              
              return (
                <button
                  key={pageNum}
                  onClick={() => handlePageChange(pageNum)}
                  className={`!h-[29px] !w-[36px] !rounded-[9px] !border flex justify-center items-center text-[12px] font-[400] ${
                    currentPage === pageNum
                      ? "!border-[#cbcbcb] !bg-[#9ca9ff] !text-[#1f1f1f]"
                      : "!border-[#cbcbcb] !text-[#1f1f1f] hover:bg-gray-100"
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            
            <button 
              onClick={() => handlePageChange(Math.min(currentPage + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="!h-[29px] !w-[36px] flex justify-center items-center !rounded-[9px] !border !border-[#cbcbcb] !text-[#1f1f1f] bg-gray-300! !p-0 disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountWiseAdsTable;