import React from "react";

const UserChatSession = ({ data }) => {
  // Check if data has valid clicks
  const hasValidClicks =
    data?.clicks?.length > 0 && data?.clicks?.some((obj) => Object.keys(obj).length > 0);

  if (!hasValidClicks) {
    return null; // Return null if there are no valid clicks
  }

  return (
    <div className="border-l-[8px] rounded-[10px] border-l-[#1877e4] border border-[#dddddd] w-full pl-[9px] pr-[18px] pb-[9px] pt-[18px] h-[420px] overflow-auto mb-[18px]">
      <div className="pb-[18px] border-b-[1px] border-[#dddddd] pl-[9px]">
        <span className="font-[600] text-[18px] text-blue-600">Click Data</span>
      </div>
      {data?.clicks.map((click, index) =>
        Object.keys(click).map((key, keyIndex) => {
          const clickData = click[key];

          // Skip rendering for specific keys
          if (
            key.includes("chatbot-card-Search Advertiser") ||
            key.match(/-?\d{10,11}-(piChart|lineChart)/) ||
            key.match(/^[-]?\d{11,}$/) ||
            key.includes("chatbot-card-chatbot-header p-3") ||
            key.includes("chatbot-card-chatbot-button close") ||
            key.includes("chatbot-card-close-chat-history") ||
            !isNaN(key.trim())
          ) {
            return null; // Skip rendering for these keys
          }

          // Render chatbot-related data
          if (key.includes("chatBot") || key.includes("chatbot-card-flex")) {
            return (
              <div key={`chatbot-${index}-${keyIndex}`} className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]">
                <p className="font-[500] text-[16px] text-[#1f1f1f]">
                  {key.includes("chatbot-card-flex") ? "chatBot-FAQ" : key}
                </p>
                <div className="flex flex-col pt-[9px]">
                  <div className="flex items-center">
                    <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                      {key.includes("chatbot-card-flex") ? "Selected-FAQ" : "N/A"}
                    </span>
                    <span className="font-[400] text-[12px] text-[#575757]">
                      {clickData?.innerText || "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center">
                      <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                        Clicks Count:
                      </span>
                      <span className="font-[400] text-[12px] text-[#575757]">
                        {clickData.count || "N/A"}
                      </span>
                    </div>
                    <div className="font-[400] text-[12px] text-[#575757]">
                      Timestamp: <span>{clickData.timestamp || "N/A"}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // Render advertiser search data
          if (key.match(/^chatbot-card-id-[a-z0-9]+-AdvertiserValue$/)) {
            return (
              <div key={`advertiser-${index}-${keyIndex}`} className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]">
                <p className="font-[500] text-[16px] text-[#1f1f1f]">Advertiser Search</p>
                <div className="flex flex-col pt-[9px]">
                  <div className="flex items-center">
                    <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                      Values:
                    </span>
                    <span className="font-[400] text-[12px] text-[#575757]">
                      {clickData?.advertiserSearchValue || "N/A"}
                    </span>
                  </div>
                  <div className="font-[400] text-[12px] text-[#575757]">
                    Timestamp: <span>{clickData.timestamp || "N/A"}</span>
                  </div>
                </div>
              </div>
            );
          }

          // Render default ad card data
          return (
            <div key={`adcard-${index}-${keyIndex}`} className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]">
              <span className="font-[400] text-[12px] text-[#575757]">{key}</span>
              <div className="flex flex-col pt-[9px]">
                <div className="flex items-center">
                  <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                    Ad ID:
                  </span>
                  <span className="font-[400] text-[12px] text-[#575757]">
                    {clickData.adId || "N/A"}
                  </span>
                </div>
                <div className="flex items-center">
                  <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                    Component:
                  </span>
                  <span className="font-[400] text-[12px] text-[#575757]">
                    {clickData.component || "N/A"}
                  </span>
                </div>
                <div className="flex items-center">
                  <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                    Action:
                  </span>
                  <span className="font-[400] text-[12px] text-[#575757]">
                    {clickData?.innerText || "N/A"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center">
                    <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
                      Clicks Count:
                    </span>
                    <span className="font-[400] text-[12px] text-[#575757]">
                      {clickData.count || "N/A"}
                    </span>
                  </div>
                  <div className="font-[400] text-[12px] text-[#575757]">
                    Timestamp: <span>{clickData.timestamp || "N/A"}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default UserChatSession;


// const UserChatSession = ({data}) => {
//   return (
//     data?.map((data,dataIndex)=>{
//    if(data?.clicks?.length > 0 && data?.clicks?.some(obj => Object.keys(obj).length > 0)){
//     return (
//       <React.Fragment key={dataIndex}>.
//       <div className="border-l-[8px] rounded-[10px] border-l-[#1877e4] border border-[#dddddd] w-full pl-[9px] pr-[18px] pb-[9px] pt-[18px] h-[420px] overflow-auto">
//     <div className="pb-[18px] border-b-[1px] border-[#dddddd] pl-[9px]">
//       <span className="font-[600] text-[18px] text-[#1877e4]">
//         Chat Session ID:
//       </span>
//       <span className="font-[600] text-[18px] text-[#575757]">
//         {" "}
//         {data?.chatSessionId}
//       </span>
//     </div>
// {
//          data?.clicks?.length > 0 && data.clicks.map((click, index) => ( 
//            Object.keys(click).map(key => {
//             const clickData = click[key];

//             if (
//               key.includes('chatbot-card-Search Advertiser') || 
//               key.match(/-?\d{10,11}-(piChart|lineChart)/) || 
//               key.match(/^[-]?\d{11,}$/) ||
//               key.includes('chatbot-card-chatbot-header p-3') || 
//               key.includes('chatbot-card-chatbot-button close')||
//               key.includes('chatbot-card-close-chat-history') ||
//               !isNaN(key.trim())
//             ) {
//               return (<>{}</>); 
//             }

//             if (key.includes('chatBot') || key.includes('chatbot-card-flex')) {
//               return (
//                 <React.Fragment key={`${index}-chatbot`}>.
//                 <div className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]">
// <p className="font-[500] text-[16px] text-[#1f1f1f] ">{key.includes('chatbot-card-flex') ? 'chatBot-FAQ' : key}</p>

// <div className="flex flex-col pt-[9px]">
//   <div className="flex items-center ">
//     <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
//     {key.includes('chatbot-card-flex') ? 'Selected-FAQ' : "N/A"}
//     </span>
//     <span className="font-[400] text-[12px] text-[#575757]">
//     {clickData?.innerText || 'N/A'}
//     </span>
//   </div>

//   <div className="flex justify-between items-center">
//     <div className="flex items-center ">
//       <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
//         Clicks Count:
//       </span>
//       <span className="font-[400] text-[12px] text-[#575757]">{clickData.count || 'N/A'}</span>
//     </div>
//     <div className="font-[400] text-[12px] text-[#575757]">
//       Timestamp: <span>{clickData.timestamp || 'N/A'}</span>
//     </div>
//   </div>
// </div>
// </div></React.Fragment>
//               )
//             }
//             if (key.match(/^chatbot-card-id-[a-z0-9]+-AdvertiserValue$/) ) {
//                return (
//                 <React.Fragment key={`${index}-advertisersearch`}>.
//                 <div className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]">
// <p className="font-[500] text-[16px] text-[#1f1f1f] ">Advertiser Search</p>

// <div className="flex flex-col pt-[9px]">
//   <div className="flex items-center ">
//     <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
//     Values:
//     </span>
//     <span className="font-[400] text-[12px] text-[#575757]">
//     {clickData?.advertiserSearchValue || 'N/A'}
//     </span>
//   </div>

//   <div className="flex justify-between items-center">
//     <div className="font-[400] text-[12px] text-[#575757]">
//       Timestamp: <span>${clickData.timestamp || 'N/A'}</span>
//     </div>
//   </div>
// </div>
// </div>
// </React.Fragment>
//                )

//               }

//             return (
//               <React.Fragment  key={`${index}-adcard`}>.
//               <div className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]">
//              <span className="font-[400] text-[12px] text-[#575757]">{key}</span>
//              <div className="flex flex-col pt-[9px]">
//   <div className="flex items-center ">
//     <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
//       Ad ID:
//     </span>
//     <span className="font-[400] text-[12px] text-[#575757]">{clickData.adId || 'N/A'}</span>
//   </div>
//   <div className="flex items-center ">
//     <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
//       Component:
//     </span>
//     <span className="font-[400] text-[12px] text-[#575757]">
//     {clickData.component || 'N/A'}
//     </span>
//   </div>
//   <div className="flex items-center ">
//     <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
//       {" "}
//       Action:
//     </span>
//     <span className="font-[400] text-[12px] text-[#575757]">
//     {clickData?.innerText || 'N/A'}
//     </span>
//   </div>
//   <div className="flex justify-between items-center">
//     <div className="flex items-center ">
//       <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
//         Clicks Count:
//       </span>
//       <span className="font-[400] text-[12px] text-[#575757]">{clickData.count || 'N/A'}</span>
//     </div>
//     <div className="font-[400] text-[12px] text-[#575757]">
//       Timestamp: <span>{clickData.timestamp || 'N/A'}</span>
//     </div>
//   </div>
// </div>
// </div>
// </React.Fragment>
//             )
//           })
//         ))
//      }
      {/* <span className="font-[400] text-[12px] text-[#575757]">
        83280-adCopyCard
      </span> */}
      {/* <div className="flex flex-col pt-[9px]">
        <div className="flex items-center ">
          <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
            Ad ID:
          </span>
          <span className="font-[400] text-[12px] text-[#575757]">83280</span>
        </div>
        <div className="flex items-center ">
          <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
            Component:
          </span>
          <span className="font-[400] text-[12px] text-[#575757]">
            adCopyCard
          </span>
        </div>
        <div className="flex items-center ">
          <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
            {" "}
            Action:
          </span>
          <span className="font-[400] text-[12px] text-[#575757]">
            Recreate Sucessful Ad
          </span>
        </div>
        <div className="flex justify-between items-center">
          <div className="flex items-center ">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              Clicks Count:
            </span>
            <span className="font-[400] text-[12px] text-[#575757]">6</span>
          </div>
          <div className="font-[400] text-[12px] text-[#575757]">
            Timestamp: <span>2025-01-20T09:50:17.632Z</span>
          </div>
        </div>
      </div> */}
    
    {/* <div className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]">
      <p className="font-[500] text-[16px] text-[#1f1f1f] ">chatBot</p>

      <div className="flex flex-col pt-[9px]">
        <div className="flex items-center ">
          <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
            N/A
          </span>
          <span className="font-[400] text-[12px] text-[#575757]">N/A</span>
        </div>

        <div className="flex justify-between items-center">
          <div className="flex items-center ">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              Clicks Count:
            </span>
            <span className="font-[400] text-[12px] text-[#575757]">48</span>
          </div>
          <div className="font-[400] text-[12px] text-[#575757]">
            Timestamp: <span>2025-01-20T09:50:17.632Z</span>
          </div>
        </div>
      </div>
    </div> */}
    {/* <div className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]">
      <p className="font-[500] text-[16px] text-[#1f1f1f] ">chatBot-FAQ</p>

      <div className="flex flex-col pt-[9px]">
        <div className="flex items-center ">
          <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
            Selected-FAQ
          </span>
          <span className="font-[400] text-[12px] text-[#575757]">
            real-estate ad inspirations
          </span>
        </div>

        <div className="flex justify-between items-center">
          <div className="flex items-center ">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              Clicks Count:
            </span>
            <span className="font-[400] text-[12px] text-[#575757]">48</span>
          </div>
          <div className="font-[400] text-[12px] text-[#575757]">
            Timestamp: <span>2025-01-20T09:50:17.632Z</span>
          </div>
        </div>
      </div>
    </div> */}
    {/* <div className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]">
      <p className="font-[500] text-[16px] text-[#1f1f1f] ">
        chatbot-card-send-msg
      </p>

      <div className="flex flex-col pt-[9px]">
        <div className="flex items-center ">
          <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
            Ad ID:
          </span>
          <span className="font-[400] text-[12px] text-[#575757]">83280</span>
        </div>
        <div className="flex items-center ">
          <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
            Component:
          </span>
          <span className="font-[400] text-[12px] text-[#575757]">
            adCopyCard
          </span>
        </div>
        <div className="flex items-center ">
          <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
            {" "}
            Action:
          </span>
          <span className="font-[400] text-[12px] text-[#575757]">
            Recreate Sucessful Ad
          </span>
        </div>
        <div className="flex justify-between items-center">
          <div className="flex items-center ">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              Clicks Count:
            </span>
            <span className="font-[400] text-[12px] text-[#575757]">6</span>
          </div>
          <div className="font-[400] text-[12px] text-[#575757]">
            Timestamp: <span>2025-01-20T09:50:17.632Z</span>
          </div>
        </div>
      </div>
    </div> */}
    {/* <div className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]">
      <p className="font-[500] text-[16px] text-[#1f1f1f] ">chatBot-FAQ</p>

      <div className="flex flex-col pt-[9px]">
        <div className="flex items-center ">
          <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
            Selected-FAQ
          </span>
          <span className="font-[400] text-[12px] text-[#575757]">
            real-estate ad inspirations
          </span>
        </div>

        <div className="flex justify-between items-center">
          <div className="flex items-center ">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              Clicks Count:
            </span>
            <span className="font-[400] text-[12px] text-[#575757]">48</span>
          </div>
          <div className="font-[400] text-[12px] text-[#575757]">
            Timestamp: <span>2025-01-20T09:50:17.632Z</span>
          </div>
        </div>
      </div>
    </div> */}
  {/* </div>
  </React.Fragment>
    )
   }
    })
  );
};

export default UserChatSession; */}
