import { createSlice } from "@reduxjs/toolkit";
import { fetchAdPositionCount, fetchAdSourceCount, fetchAdsCount, fetchAdsCountMeta, fetchAdsCountPython, fetchAdsCountScroll, fetchAdsGraphCount, fetchAllUsers, fetchGeneratedMedia, fetchRangeCounts, fetchTiktokAdsCount, fetchTiktokAdsGraphCount, fetchTotalAdsCount, fetchUserDetails, fetchUsersStats, fetchUserUsageCost,fetchUsersWithGeneratedMedia, fetchGeneratedMediaSpendingReport  } from "../actions/adsgptActions";

const initialState = {
  loading: false,
  error: null,
  users: [],
  user: {},
  userId: "",
  userStats:{},
  searchResultCounts:[],
  searchResultCountsScroll:[],
  searchResultCountsPython:[],
  searchResultCountsMeta:[],
  searchResultTotalAdsCount :[],
  searchResultRangeCounts: null,
  searchResultCountsTiktok:[],
  searchSourceCount:[],
  searchPositionCount:[],
  searchAdsCountGraph:[],
  userUsageCost: null,
  generatedMedia: [],
  generatedMediaHasMore: true,
  generatedMediaPage: 1,
  spendingReport: [],
  userMediaSpending: null,
};

const adsgptSlice = createSlice({
  name: "adsgpt",
  initialState,
  reducers: {
    updateSearchPositionCount: (state, action) => {
      state.searchPositionCount = action.payload; 
    },
    updateSearchSourceCount: (state, action) => {
      state.searchSourceCount = action.payload; 
    },
  },
  extraReducers: (builder) => {
    // Handle fetch all users
    builder
      .addCase(fetchAllUsers.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchAllUsers.fulfilled, (state, action) => {
        state.loading = false;
        state.users = action.payload
      })
      .addCase(fetchAllUsers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

      //Handle specific user
      builder
      .addCase(fetchUserDetails.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchUserDetails.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload
      })
      .addCase(fetchUserDetails.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      }); 

      //Handle UserStats
      builder
      .addCase(fetchUsersStats.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchUsersStats.fulfilled, (state, action) => {
        state.loading = false;
        state.userStats = action.payload
      })
      .addCase(fetchUsersStats.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      }); 

       //total 
       builder
       .addCase(fetchAdsCount.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchAdsCount.fulfilled, (state, action) => {
        state.loading = false;
        state.searchResultCounts = action.payload;
      })
      .addCase(fetchAdsCount.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

      //scroll
      builder
       .addCase(fetchAdsCountScroll.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchAdsCountScroll.fulfilled, (state, action) => {
        state.loading = false;
        state.searchResultCountsScroll = action.payload;
      })
      .addCase(fetchAdsCountScroll.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

      //python-ad-count
      builder
      .addCase(fetchAdsCountPython.pending, (state) => {
       state.loading = true;
     })
     .addCase(fetchAdsCountPython.fulfilled, (state, action) => {
       state.loading = false;
       state.searchResultCountsPython = action.payload;
     })
     .addCase(fetchAdsCountPython.rejected, (state, action) => {
       state.loading = false;
       state.error = action.payload;
     });

      //Meta-ad-count
      builder
      .addCase(fetchAdsCountMeta.pending, (state) => {
       state.loading = true;
     })
     .addCase(fetchAdsCountMeta.fulfilled, (state, action) => {
       state.loading = false;
       state.searchResultCountsMeta = action.payload;
     })
     .addCase(fetchAdsCountMeta.rejected, (state, action) => {
       state.loading = false;
       state.error = action.payload;
     });

      //range-counts (Q2 new + Q3 active from main table)
      builder
      .addCase(fetchRangeCounts.pending, (state) => {
        state.searchResultRangeCounts = null;
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchRangeCounts.fulfilled, (state, action) => {
        state.loading = false;
        state.searchResultRangeCounts = action.payload;
      })
      .addCase(fetchRangeCounts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

      //total-ad-count
      builder
      .addCase(fetchTotalAdsCount.pending, (state) => {
        state.searchResultTotalAdsCount = null;
       state.loading = true;
       state.error = null;
     })
     .addCase(fetchTotalAdsCount.fulfilled, (state, action) => {
       state.loading = false;
       state.searchResultTotalAdsCount = action.payload;
     })
     .addCase(fetchTotalAdsCount.rejected, (state, action) => {
       state.loading = false;
       state.error = action.payload;
     });
      //source
      builder
      .addCase(fetchAdSourceCount.pending, (state) => {
       state.loading = true;
     })
     .addCase(fetchAdSourceCount.fulfilled, (state, action) => {
       state.loading = false;
       state.searchSourceCount = action.payload;
     })
     .addCase(fetchAdSourceCount.rejected, (state, action) => {
       state.loading = false;
       state.error = action.payload;
     });

     //position
     builder
      .addCase(fetchAdPositionCount.pending, (state) => {
       state.loading = true;
     })
     .addCase(fetchAdPositionCount.fulfilled, (state, action) => {
       state.loading = false;
       state.searchPositionCount = action.payload;
     })
     .addCase(fetchAdPositionCount.rejected, (state, action) => {
       state.loading = false;
       state.error = action.payload;
     });

     //graph-count
     builder
     .addCase(fetchAdsGraphCount.pending, (state) => {
      state.loading = true;
    })
    .addCase(fetchAdsGraphCount.fulfilled, (state, action) => {
      state.loading = false;
      state.searchAdsCountGraph = action.payload;
    })
    .addCase(fetchAdsGraphCount.rejected, (state, action) => {
      state.loading = false;
      state.error = action.payload;
    });

         //tiktok-ads
         builder
         .addCase(fetchTiktokAdsCount.pending, (state) => {
          state.loading = true;
        })
        .addCase(fetchTiktokAdsCount.fulfilled, (state, action) => {
          state.loading = false;
          state.searchResultCountsTiktok = action.payload;
        })
        .addCase(fetchTiktokAdsCount.rejected, (state, action) => {
          state.loading = false;
          state.error = action.payload;
        });
     
        //graph-tiktok
        builder
        .addCase(fetchTiktokAdsGraphCount.pending, (state) => {
         state.loading = true;
       })
       .addCase(fetchTiktokAdsGraphCount.fulfilled, (state, action) => {
         state.loading = false;
         state.searchAdsCountGraph = action.payload;
       })
       .addCase(fetchTiktokAdsGraphCount.rejected, (state, action) => {
         state.loading = false;
         state.error = action.payload;
       });


    // user-usage-cost
    builder
      .addCase(fetchUserUsageCost.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchUserUsageCost.fulfilled, (state, action) => {
        state.loading = false;
        state.userUsageCost = action.payload;
      })
      .addCase(fetchUserUsageCost.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // generated-media
    builder
      .addCase(fetchGeneratedMedia.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchGeneratedMedia.fulfilled, (state, action) => {
        state.loading = false;
        const incoming = action.payload?.data || [];
        const page = action.payload?.page || 1;

        if (page === 1) {
          state.generatedMedia = incoming;
        } else {
          state.generatedMedia = [...state.generatedMedia, ...incoming];
        }

        state.generatedMediaHasMore = action.payload?.hasMore || false;
        state.generatedMediaPage = page;
        state.userMediaSpending = action.payload?.spending || null;
      })
      .addCase(fetchGeneratedMedia.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

     builder
      .addCase(fetchUsersWithGeneratedMedia.pending, (state) => {
       state.loading = true;
       })
      .addCase(fetchUsersWithGeneratedMedia.fulfilled, (state, action) => {
       state.loading = false;
       state.users = action.payload;
       })
       .addCase(fetchUsersWithGeneratedMedia.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
        });

    builder
      .addCase(fetchGeneratedMediaSpendingReport.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchGeneratedMediaSpendingReport.fulfilled, (state, action) => {
        state.loading = false;
        state.spendingReport = action.payload;
      })
      .addCase(fetchGeneratedMediaSpendingReport.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });



  },
});
export const {updateSearchPositionCount} = adsgptSlice.actions;
export const {updateSearchSourceCount} = adsgptSlice.actions;
export default adsgptSlice.reducer;
