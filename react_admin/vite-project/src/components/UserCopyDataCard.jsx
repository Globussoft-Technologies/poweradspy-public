import React from "react";

const UserCopyDataCard = ({ data }) => {
  const copyArray = Array?.isArray(data?.copy) ? data?.copy : [];

  const hasValidData = copyArray?.some(obj =>
    obj && Object?.keys(obj)?.length > 0
  );
  
  if (!hasValidData) {
    return null; // Don't render if there's no meaningful copy data
  }
  return (
    <div className="border-l-[8px] rounded-[10px] border-l-[#a0edf0] border border-[#dddddd] w-full pl-[9px] pr-[18px] pb-[9px] pt-[18px] h-[420px] overflow-auto mb-[18px]">
      <div className="pb-[18px] border-b-[1px] border-[#dddddd] pl-[9px]">
        <span className="font-[600] text-[18px] text-[#a0edf0]">Copy Data</span>
      </div>
      {data?.copy?.map((copyData, index) =>
        Object.keys(copyData)?.map((key, keyIndex) => {
          const copyKey = copyData[key];
          const copiedText = copyKey?.copiedText?.join("||") || "N/A";

          const renderContent = (
            <>
              <div className="flex items-center">
                <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                  Ad ID:
                </span>
                <span className="font-[400] text-[12px] text-[#575757]">
                  {copyKey?.adId || "N/A"}
                </span>
              </div>
              <div className="flex items-center">
                <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                  Component:
                </span>
                <span className="font-[400] text-[12px] text-[#575757]">
                  {key?.includes("chats-chatbot-card")
                    ? "ChatBot-Chats"
                    : copyKey?.component || "N/A"}
                </span>
              </div>
              <div className="flex flex-col pt-[9px]">
              <span className="font-[500] text-[12px] text-[#1f1f1f] mb-1">
                Copy Text:
              </span>
              <span className="font-[400] text-[12px] text-[#575757] break-words whitespace-pre-wrap">
                {copiedText}
              </span>
            </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                    {key?.includes("chats-chatbot-card")
                      ? "Copy Count:"
                      : "Clicks Count:"}
                  </span>
                  <span className="font-[400] text-[12px] text-[#575757]">
                    {copyKey?.count || "N/A"}
                  </span>
                </div>
                <div className="font-[400] text-[12px] text-[#575757]">
                  Timestamp: <span>{copyKey?.timestamp || "N/A"}</span>
                </div>
              </div>
            </>
          );

          return (
            <div
              key={`adcard-${index}-${keyIndex}`}
              className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]"
            >
              <span className="font-[400] text-[12px] text-[#575757]">{key}</span>
              <div className="flex flex-col pt-[9px]">{renderContent}</div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default UserCopyDataCard;
