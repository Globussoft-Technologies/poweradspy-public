import { useEffect, useState } from "react";

const DomainProcessCountTable = ({ domains, loading }) => {
  const [domainList, setDomainList] = useState([]);

  useEffect(() => {
    console.log(domains);
    if (domains && !loading) {
      setDomainList(domains);
    }
  }, [domains, loading]);

  return (
    <div className="w-full flex flex-col">
      <div className="w-full rounded-xl border border-[#e8e8e8] bg-white shadow-sm mt-[30px]">
        {/* Header */}
        <div className="pt-[17px] pb-[19px] pl-[24px] pr-[14px]">
          <p className="text-[17px] font-[600] text-[#1E1B39]">
            Network Wise Domain Process
          </p>
        </div>

        {/* Table */}
        <div className="overflow-auto w-full h-[100%]">
          <table className="min-w-full table-fixed">
            <thead className="sticky top-0">
              <tr className="border-b border-gray-100 bg-[#F9F9FB] text-center">
                <th className="!px-[29px] !py-[22px] text-[16px] font-[400] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent">
                  Network
                </th>
                <th className="!px-[29px] !py-[22px] text-[16px] font-[400] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent">
                  Total Domain Date Updated
                </th>
                <th className="!px-[29px] !py-[22px] text-[16px] font-[400] bg-gradient-to-r from-[#3F51B5] to-[#673AB7] bg-clip-text text-transparent">
                  Total Lander Ad Processed
                </th>
              </tr>
            </thead>
            <tbody className="text-[14px] font-[400] text-[#1F1F1F]">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="!px-[29px] !py-[21px]">
                      <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse" />
                    </td>
                    <td className="!px-[29px] !py-[21px]">
                      <div className="h-4 bg-gray-200 rounded w-1/2 animate-pulse" />
                    </td>
                    <td className="!px-[29px] !py-[21px]">
                      <div className="h-4 bg-gray-200 rounded w-2/3 animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : domainList?.length > 0 ? (
                domainList?.map((domain, index) => (
                  <tr key={index} className="border-b border-gray-100 text-center">
                    <td className="!px-[29px] !py-[21px] whitespace-normal break-words max-w-[320px]">
                      {domain?.network}
                    </td>
                    <td className="!px-[29px] !py-[21px]">
                      {domain?.total_domain_date_updated}
                    </td>
                    <td className="!px-[29px] !py-[21px]">
                      {domain?.total_lander_ad_processed}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="3"
                    className="h-[320px] rounded-b-2xl bg-gray-200"
                  >
                    <div className="w-full h-full flex items-center justify-center">
                      No Domains found
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DomainProcessCountTable;