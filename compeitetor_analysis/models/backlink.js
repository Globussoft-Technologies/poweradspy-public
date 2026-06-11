import mongoose from 'mongoose';

const backlinkRequestSchema = mongoose.Schema(
    {

       domain_name: {
        type: String,
        trim: true,
        required: true
       },
          referring_page: {
            type: String,
            trim: true
          },
          dr: {
            type: Number
          },
          url: {
            type: String,
            trim: true
          },
          domain_traffic: {
            type: Number
          },
          referring_domains: [
            {
              type: String,
              trim: true
            }
          ],
          linked_domains: [
            {
              type: String,
              trim: true
            }
          ],
          external_links: [
            {
              type: String,
              trim: true
            }
          ],
          page_traffic: {
            type: Number
          },
          anchor_and_target_url: {
            type: String,
            trim: true
          },
          date: {
            type: Date
          },
          similar: {
            type: Boolean,
            default: false
          },
          inspect: {
            type: Boolean,
            default: false
          },
          created_at: {
            type: Date,
            default: Date.now
          }
        });

const Backlink = mongoose.model('backlink',backlinkRequestSchema);

export default Backlink;