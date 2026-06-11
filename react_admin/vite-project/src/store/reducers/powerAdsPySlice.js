import { createSlice } from "@reduxjs/toolkit";
import {
  fetchAdsFromAffiliateplatforms,
  fetchAdsFromEcommerceplatforms,
  fetchAdsFromFunnel,
  fetchNetworksCountries,
  fetchNetworkTypesCount,
  fetchTiktokAdsCountryCount,
  fetchAccountDetails,
  fetchSystemDetails,
  fetchPerticularSystemDetails,
  fetchPerticularSystemAccountDetails,
  fetchSystemInsites,
  fetchSystemInfo,
  fetchSystemInfoAccountsList,
  fetchSystemInfoAccounts,
  fetchStatusSystemInfo,
  fetchStatusAccountInfo,
  fetchDomaninProcessDetails
} from "./../actions/powerAdsPyActionsApi";
const initialState = {
  countData: [],
  countryData: [],
  funnelData: [],
  adsEcommerceplatFormsData: [],
  adsAffiliateData:[],
  accountData :[],
  domainProcessData:[],
  loadingDomainsData:false,
  loadingData: false,
  loadingAccoutData:false,
  loadingSystemData:false,
  loadingSystemInsites:false,
  loadingSystemInfo:false,
  loadingSystemInfoAccountLists:false,
  loadingSystemInfoAccount:false,
  loadingStatusSystemInfo:false,
  loadingStatusAccountInfo:false,
  error: null,
  nextCursorForAffiliateData: null,
  nextCursorForFunnel: null,
  nextCursorForEcommerce: null,
  cursorStackForAffiliateData: [],
  cursorStackForFunnel: [],
  cursorStackForEcommerce: [],
  systemDetails:[],
  perticularSystemDetails:[],
  systemAccountDetails:[],
  SystemInsites:[],
  SystemInfo:[],
  SystemInfoAccountLists:[],
  SystemInfoAccount:[],
  SystemInsitesAdsCount:[],
  StatusSystemInfo:[],
  AccountInfo:[],
  network: "",
};


const networkTypesSlice = createSlice({
  name: "poweradspy",
  initialState,
  reducers: {
    updateCountData: (state, action) => {
      state.countData = action.payload; // Update countData
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchNetworkTypesCount.pending, (state) => {
        state.loadingData = true;
        state.error = null;
      })
      .addCase(fetchNetworkTypesCount.fulfilled, (state, action) => {
        state.loadingData = false;
        state.countData = action.payload;
      })
      .addCase(fetchNetworkTypesCount.rejected, (state, action) => {
        state.loadingData = false;
        state.error = action.payload;
      });

    //Handle network-countries
    builder
      .addCase(fetchNetworksCountries.pending, (state) => {
        state.loadingData = true;
      })
      .addCase(fetchNetworksCountries.fulfilled, (state, action) => {
        state.loadingData = false;
        state.countryData = action.payload;
      })
      .addCase(fetchNetworksCountries.rejected, (state, action) => {
        state.loadingData = false;
        state.error = action.payload;
      });

    //Handle AdsFromFunnel
    builder
    .addCase(fetchAdsFromFunnel.pending, (state) => {
      state.loadingData = true;
      state.error = null;
    })
    .addCase(fetchAdsFromFunnel.fulfilled, (state, action) => {
      const { data, searchAfter, isPrev, cursor, network } = action.payload;
    
      state.funnelData = data;
      state.network = network;

      if (!isPrev && cursor) {
        state.cursorStackForFunnel.push(cursor);
      } else if (isPrev) {
        state.cursorStackForFunnel.pop();
      }

      state.nextCursorForFunnel = searchAfter;
      state.loadingData = false;
    })
    .addCase(fetchAdsFromFunnel.rejected, (state, action) => {
      state.loadingData = false;
      state.error = action.payload;
    });
      builder
      .addCase(fetchAdsFromEcommerceplatforms.pending, (state) => {
        state.loadingData = true;
        state.error = null;
      })
      .addCase(fetchAdsFromEcommerceplatforms.fulfilled, (state, action) => {
        const { data, searchAfter, isPrev, cursor, network } = action.payload;
      
        state.adsEcommerceplatFormsData = action.payload;
        state.network = network;
  
        if (!isPrev && cursor) {
          state.cursorStackForEcommerce.push(cursor);
        } else if (isPrev) {
          state.cursorStackForEcommerce.pop();
        }
  
        state.nextCursorForEcommerce = searchAfter;
        state.loadingData = false;
      })
      .addCase(fetchAdsFromEcommerceplatforms.rejected, (state, action) => {
        state.loadingData = false;
        state.error = action.payload;
      });

      //Handle Affiliate network
    builder
    .addCase(fetchAdsFromAffiliateplatforms.pending, (state) => {
      state.loadingData = true;
      state.error = null;
    })
    .addCase(fetchAdsFromAffiliateplatforms.fulfilled, (state, action) => {
      const { data, searchAfter, isPrev, cursor, network } = action.payload;
    
      state.adsAffiliateData = action.payload;
      state.network = network;

      if (!isPrev && cursor) {
        state.cursorStackForAffiliateData.push(cursor);
      } else if (isPrev) {
        state.cursorStackForAffiliateData.pop();
      }

      state.nextCursorForAffiliateData = searchAfter;
      state.loadingData = false;
    })
    .addCase(fetchAdsFromAffiliateplatforms.rejected, (state, action) => {
      state.loadingData = false;
      state.error = action.payload;
    });
    //country-map
    builder
      .addCase(fetchTiktokAdsCountryCount.pending, (state) => {
        state.loadingData = true;
      })
      .addCase(fetchTiktokAdsCountryCount.fulfilled, (state, action) => {
        state.loadingData = false;
        state.countryData = action.payload;
      })
      .addCase(fetchTiktokAdsCountryCount.rejected, (state, action) => {
        state.loadingData = false;
        state.error = action.payload;
      });

      //Accounts details
      builder
      .addCase(fetchAccountDetails.pending, (state) => {
        state.loadingData = true;
      })
      .addCase(fetchAccountDetails.fulfilled, (state, action) => {
        state.loadingData = false;
        state.accountData = action.payload;
      })
      .addCase(fetchAccountDetails.rejected, (state, action) => {
        state.loadingData = false;
        state.error = action.payload;
      });
      
      //Domain Process
          builder
          .addCase(fetchDomaninProcessDetails.pending, (state) => {
            state.loadingDomainsData = true;
          })
          .addCase(fetchDomaninProcessDetails.fulfilled, (state, action) => {
            state.loadingDomainsData = false;
            state.domainProcessData = action.payload;
          })
          .addCase(fetchDomaninProcessDetails.rejected, (state, action) => {
            state.loadingDomainsData = false;
            state.error = action.payload;
          });
      //System details
      builder
      .addCase(fetchSystemDetails.pending, (state) => {
        state.loadingSystemData = true;
      })
      .addCase(fetchSystemDetails.fulfilled, (state, action) => {
        state.loadingSystemData = false;
        state.systemDetails = action.payload;
      })
      .addCase(fetchSystemDetails.rejected, (state, action) => {
        state.loadingSystemData = false;
        state.error = action.payload;
      });

       //Perticular System details
       builder
       .addCase(fetchPerticularSystemDetails.pending, (state) => {
         state.loadingAccoutData = true;
       })
       .addCase(fetchPerticularSystemDetails.fulfilled, (state, action) => {
         state.loadingAccoutData = false;
         state.perticularSystemDetails = action.payload;
       })
       .addCase(fetchPerticularSystemDetails.rejected, (state, action) => {
         state.loadingAccoutData = false;
         state.error = action.payload;
       });

        //Perticular System Account details
        builder
        .addCase(fetchPerticularSystemAccountDetails.pending, (state) => {
          state.loadingAccoutData = true;
        })
        .addCase(fetchPerticularSystemAccountDetails.fulfilled, (state, action) => {
          state.loadingAccoutData = false;
          state.systemAccountDetails = action.payload;
        })
        .addCase(fetchPerticularSystemAccountDetails.rejected, (state, action) => {
          state.loadingAccoutData = false;
          state.error = action.payload;
        });

         //Perticular System Account details
         builder
         .addCase(fetchSystemInsites.pending, (state) => {
           state.loadingSystemInsites = true;
         })
         .addCase(fetchSystemInsites.fulfilled, (state, action) => {
           state.loadingSystemInsites= false;
           state.SystemInsites = action.payload.detailsData;
           state.SystemInsitesAdsCount = action.payload.summary;
         })
         .addCase(fetchSystemInsites.rejected, (state, action) => {
           state.loadingSystemInsites = false;
           state.error = action.payload;
         });

         //All SystemInfo details
         builder
         .addCase(fetchSystemInfo.pending, (state) => {
           state.loadingSystemInfo = true;
         })
         .addCase(fetchSystemInfo.fulfilled, (state, action) => {
           state.loadingSystemInfo= false;
           state.SystemInfo = action.payload;
         })
         .addCase(fetchSystemInfo.rejected, (state, action) => {
           state.loadingSystemInfo = false;
           state.error = action.payload;
         });

           //Perticular SystemInfoAccount details
           builder
           .addCase(fetchSystemInfoAccounts.pending, (state) => {
             state.loadingSystemInfoAccount = true;
           })
           .addCase(fetchSystemInfoAccounts.fulfilled, (state, action) => {
             state.loadingSystemInfoAccount= false;
             state.SystemInfoAccount = action.payload;
           })
           .addCase(fetchSystemInfoAccounts.rejected, (state, action) => {
             state.loadingSystemInfoAccount = false;
             state.error = action.payload;
           });

           //All SystemInfoAccountLists details
           builder
           .addCase(fetchSystemInfoAccountsList.pending, (state) => {
             state.loadingSystemInfoAccountLists = true;
           })
           .addCase(fetchSystemInfoAccountsList.fulfilled, (state, action) => {
             state.loadingSystemInfoAccountLists= false;
             state.SystemInfoAccountLists = action.payload;
           })
           .addCase(fetchSystemInfoAccountsList.rejected, (state, action) => {
             state.loadingSystemInfoAccountLists = false;
             state.error = action.payload;
           });

           //All Status SystemInfo details
           builder
           .addCase(fetchStatusSystemInfo.pending, (state) => {
             state.loadingStatusSystemInfo = true;
           })
           .addCase(fetchStatusSystemInfo.fulfilled, (state, action) => {
             state.loadingStatusSystemInfo= false;
             state.StatusSystemInfo = action.payload;
           })
           .addCase(fetchStatusSystemInfo.rejected, (state, action) => {
             state.loadingStatusSystemInfo = false;
             state.error = action.payload;
           });
           //All Status SystemInfo details
           builder
           .addCase(fetchStatusAccountInfo.pending, (state) => {
             state.loadingStatusAccountInfo = true;
           })
           .addCase(fetchStatusAccountInfo.fulfilled, (state, action) => {
             state.loadingStatusAccountInfo = false;
             state.AccountInfo = action.payload;
           })
           .addCase(fetchStatusAccountInfo.rejected, (state, action) => {
             state.loadingStatusAccountInfo = false;
             state.error = action.payload;
           });
  },
});

export const { updateCountData } = networkTypesSlice.actions;
export default networkTypesSlice.reducer;
