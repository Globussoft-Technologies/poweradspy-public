import React from "react";

const UserAdCreativeDataCard = ({ data }) => {

  const filteredData = data?.adCreativeSide.filter(creative =>
    Object.values(creative).some(value => value !== null && value !== "")
  )

  if (!filteredData || filteredData.length === 0) {
    return null;
  }

  return (
    <div className="border-l-[8px] rounded-[10px] border-l-[#7718c0] border border-[#dddddd] w-full pl-[9px] pr-[18px] pb-[9px] pt-[18px] h-[420px] overflow-auto mb-[18px]">
      <div className="pb-[18px] border-b-[1px] border-[#dddddd] pl-[9px]">
        <span className="font-[600] text-[18px] text-[#7718c0]">
          AdCreative Data
        </span>
      </div>

      {filteredData.map((creative, creativeIndex) => (
        <div
          key={creativeIndex}
          className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]"
        >
          <p className="font-[500] text-[16px] text-[#1f1f1f]">
            BrandDescription:
          </p>
          <span className="font-[400] text-[12px] text-[#575757]">
            {creative?.brandDescription || "N/A"}
          </span>
          <div className="flex flex-col pt-[9px]">
            <div className="flex items-center ">
              <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                BrandName:
              </span>
              <span className="font-[400] text-[12px] text-[#575757]">
                {creative?.brandName || "N/A"}
              </span>
            </div>
            <div className="flex items-center ">
              <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                CallToAction:
              </span>
              <span className="font-[400] text-[12px] text-[#575757]">
                {creative?.cta || "N/A"}
              </span>
            </div>
            <div className="flex items-center ">
              <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                Platform:
              </span>
              <span className="font-[400] text-[12px] text-[#575757]">
                {creative?.platform || "N/A"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <div className="font-[400] text-[12px] text-[#575757]">
                Timestamp: <span>{creative?.timestamp || "N/A"}</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default UserAdCreativeDataCard;

   