import React from "react";

const UserScrollDataCard = ({ data }) => {
  // console.log(data);
  const filteredData = data.scroll?.filter(scroll =>
    Object.values(scroll).some(
      scrollData =>
        scrollData?.scrollCount ||
        scrollData?.totalPercentSeen ||
        scrollData?.totalNewDataFetched ||
        (scrollData?.adId && scrollData.adId.length > 0)
    )
  );

  if (!filteredData || filteredData.length === 0) {
    return null;
  }

  return (
    <div className="border-l-[8px] rounded-[10px] border-l-[#ff8800] border border-[#dddddd] w-full pl-[9px] pr-[18px] pb-[9px] pt-[18px] h-[420px] overflow-auto mb-[18px]">
      <div className="pb-[18px] border-b-[1px] border-[#dddddd] pl-[9px]">
        <span className="font-[600] text-[18px] text-[#ff8800]">Scroll Data</span>
      </div>

      {filteredData.map((scroll, scrollIndex) =>
        Object.keys(scroll).map((key, keyIndex) => {
          const scrollData = scroll[key];

          return (
            <div key={`${scrollIndex}-${keyIndex}`} className="border-b-[1px] border-[#dddddd] pl-[9px] py-[18px]">
              <p className="font-[500] text-[16px] text-[#1f1f1f]">{key}</p>

              <div className="flex flex-col pt-[9px]">
                <div className="flex items-center">
                  <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">Scroll Count:</span>
                  <span className="font-[400] text-[12px] text-[#575757]">{scrollData?.scrollCount || 0}</span>
                </div>

                <div className="flex items-center">
                  <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">Total Percent Seen:</span>
                  <span className="font-[400] text-[12px] text-[#575757]">{scrollData?.totalPercentSeen || 0}</span>
                </div>

                <div className="flex items-center">
                  <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">Total New Data Fetched:</span>
                  <span className="font-[400] text-[12px] text-[#575757]">
                    {scrollData?.totalNewDataFetched || scrollData?.adId?.length || 0}
                  </span>
                </div>

                <div className="flex items-center w-full">
                  <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">Ads Seen:</span>
                  <span className="font-[400] text-[12px] text-[#575757] break-words w-[calc(100%-192px)]">
                    {scrollData?.adId ? scrollData.adId.join(", ") : 0}
                  </span>
                </div>

                <div className="font-[400] text-[12px] text-[#575757] flex justify-end">
                  Timestamp: <span>{ scrollData?.timestamp || "N/A"}</span>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default UserScrollDataCard;

        {/* <div className="flex flex-col pt-[9px]">
          <div className="flex items-center ">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              Scroll Count:
            </span>
            <span className="font-[400] text-[12px] text-[#575757]">0</span>
          </div>
          <div className="flex items-center ">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              Total Percent Seen:
            </span>
            <span className="font-[400] text-[12px] text-[#575757]">0</span>
          </div>
          <div className="flex items-center ">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              {" "}
              Total New Data Fetched:
            </span>
            <span className="font-[400] text-[12px] text-[#575757]">20</span>
          </div>

          <div className="flex items-center w-full">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              Ads Seen:
            </span>
            <span className="font-[400] text-[12px] text-[#575757] break-words w-[calc(100%-192px)]">
              Lorem ipsum dolor sit amet consectetur adipisicing elit. Autem
              beatae dicta, delectus debitis cupiditate quasi, obcaecati aut
              possimus non amet totam voluptatem optio distinctio! Dignissimos
              placeat provident excepturi minima obcaecati dolor, ipsum alias
              recusandae odio, iusto eligendi optio illo nam amet ducimus veniam
              cumque dolore explicabo. Dolorem, pariatur quia commodi
              repellendus velit maxime distinctio sapiente labore optio. Odio
              rem, totam dolores ducimus deleniti sint repellat nemo praesentium
              ab, error exercitationem, aspernatur a veniam voluptatibus esse
              quas. Commodi nostrum amet, voluptate temporibus quos recusandae
              quidem ipsum corrupti. Deserunt dolore eos quisquam quo aut nam
              corrupti totam laudantium cupiditate? Obcaecati atque explicabo
              minus sunt ducimus commodi, magni vero nostrum. Esse natus nihil
              sapiente delectus error consectetur quibusdam fugiat, sequi porro
              maiores dolorem corporis minus soluta quasi nobis, ullam officia
              dolor consequuntur cum ab necessitatibus dolore! Debitis rem
              distinctio quam veritatis quasi doloribus?
            </span>
          </div>

          <div className="font-[400] text-[12px] text-[#575757] flex justify-end">
            Timestamp: <span>2025-01-20T09:50:17.632Z</span>
          </div>
        </div> */}

      {/* <div className=" pl-[9px] py-[18px]">
        <p className="font-[500] text-[16px] text-[#1f1f1f] ">
          scrollAdContainer
        </p>

        <div className="flex flex-col pt-[9px]">
          <div className="flex items-center ">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              Scroll Count:
            </span>
            <span className="font-[400] text-[12px] text-[#575757]">0</span>
          </div>
          <div className="flex items-center ">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              Total Percent Seen:
            </span>
            <span className="font-[400] text-[12px] text-[#575757]">0</span>
          </div>
          <div className="flex items-center ">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              {" "}
              Total New Data Fetched:
            </span>
            <span className="font-[400] text-[12px] text-[#575757]">20</span>
          </div>

          <div className="flex items-center w-full">
            <span className="font-[500] text-[12px] text-[#1f1f1f] w-[192px]">
              Ads Seen:
            </span>
            <span className="font-[400] text-[12px] text-[#575757] break-words w-[calc(100%-192px)]">
              Lorem ipsum dolor sit amet consectetur adipisicing elit. Autem
              beatae dicta, delectus debitis cupiditate quasi, obcaecati aut
              possimus non amet totam voluptatem optio distinctio! Dignissimos
              placeat provident excepturi minima obcaecati dolor, ipsum alias
              recusandae odio, iusto eligendi optio illo nam amet ducimus veniam
              cumque dolore explicabo. Dolorem, pariatur quia commodi
              repellendus velit maxime distinctio sapiente labore optio. Odio
              rem, totam dolores ducimus deleniti sint repellat nemo praesentium
              ab, error exercitationem, aspernatur a veniam voluptatibus esse
              quas. Commodi nostrum amet, voluptate temporibus quos recusandae
              quidem ipsum corrupti. Deserunt dolore eos quisquam quo aut nam
              corrupti totam laudantium cupiditate? Obcaecati atque explicabo
              minus sunt ducimus commodi, magni vero nostrum. Esse natus nihil
              sapiente delectus error consectetur quibusdam fugiat, sequi porro
              maiores dolorem corporis minus soluta quasi nobis, ullam officia
              dolor consequuntur cum ab necessitatibus dolore! Debitis rem
              distinctio quam veritatis quasi doloribus?
            </span>
          </div>

          <div className="font-[400] text-[12px] text-[#575757] flex justify-end">
            Timestamp: <span>2025-01-20T09:50:17.632Z</span>
          </div>
        </div>
      </div> */}
//     </div>
//   );
// };

// export default UserScrollDataCard;
