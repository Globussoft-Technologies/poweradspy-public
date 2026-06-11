import mongoose from "mongoose";

const PaidSearchSchema = mongoose.Schema({

    domain_name: {type: String,trim: true,required: true},
    keywords: {type:String, trim: true, required: true},
    url: {type: String, trim: true},
    external_links: [{type: String, trim: true}],
    top_keyword_volume: Number,
    kd: Number,
    cpc: Number,
    paid_org_ratio: Number,
    value: Number,
    sum_traffic: Number,
    top_keyword_best_positon: Number,
});

const Paid_search = mongoose.model("paid_search",PaidSearchSchema);

export default Paid_search;
