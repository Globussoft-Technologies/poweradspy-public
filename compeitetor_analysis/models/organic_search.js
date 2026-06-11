import mongoose from 'mongoose';

const OrganicSearchSchema = mongoose.Schema({


    domain_name: { type: String,trim: true,required: true },
    keyword: { type:String, trim:true, required: true},
    is_transactional: Boolean,
    sf: Number,
    volume: Number,
    kd: Number,
    cpc: Number,
    traffic: Number,
    best_position_diff: Number,
    sum_paid_traffic: Number,
    best_positon: Number,
    best_postion_url: {type:String,trim:true},
});

const Organic_search = mongoose.model("organic_search",OrganicSearchSchema);

export default Organic_search;