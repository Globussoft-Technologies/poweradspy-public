require('dotenv').config();
const searchAllInstances = require('../es-connections/connection');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');

// Q1-equivalent (lifetime total) via Elasticsearch — with the same per-network
// displayable-media filter the new-ui-react frontend applies. Keeping the
// filter on means the admin dashboard's "Total Ads" header matches the count
// the end user sees.
const ES_DATA = {
    facebook:  { es_id: 0, index: process.env.FB_INDEX },
    instagram: { es_id: 3, index: process.env.INSTA_INDEX },
    google:    { es_id: 4, index: process.env.GT_INDEX },
    quora:     { es_id: 2, index: process.env.QUORA_INDEX },
    native:    { es_id: 1, index: process.env.NATIVE_INDEX },
    gdn:       { es_id: 2, index: process.env.GDN_INDEX },
    pinterest: { es_id: 2, index: process.env.PINT_INDEX },
    reddit:    { es_id: 1, index: process.env.REDDIT_INDEX },
    bing:      { es_id: 0, index: process.env.BING_INDEX },
    linkedin:  { es_id: 1, index: process.env.LINKEDIN_INDEX },
    youtube:   { es_id: 0, index: process.env.YT_INDEX },
};

const totalAdsCountFilter = async (req, res) => {
    try {
        const { network } = req.body;
        if (!network || !ES_DATA[network]) {
            return res.status(400).json({ message: 'Please provide valid network' });
        }

        const mediaFilters = getDisplayableMediaFilter(network); // array | null
        const query = (mediaFilters && mediaFilters.length)
            ? { query: { bool: { filter: mediaFilters } } }
            : { query: { match_all: {} } };

        const responseType = 'count';

        const typeCount = await searchAllInstances(
            ES_DATA[network].index,
            query,
            ES_DATA[network].es_id,
            responseType
        );
        const totalCount = typeCount?.data ? typeCount.data : 0;
        return res.status(200).json(totalCount);
    } catch (error) {
        console.error('Error fetching total ad count:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = { totalAdsCountFilter };
