import { useState } from 'react';

/**
 * useFilters
 * Centralises every filter state value and provides helpers.
 * Returns state, setters, totalActiveFilters count, and clearAll().
 */
export const useFilters = () => {
    // Multi-select filters
    const [selCategories, setSelCategories] = useState([]);
    const [selAdTypes, setSelAdTypes] = useState([]);
    const [selCTAs, setSelCTAs] = useState([]);
    const [selCountries, setSelCountries] = useState([]);
    const [selEcommerce, setSelEcommerce] = useState([]);
    const [selFunnels, setSelFunnels] = useState([]);
    const [selAffiliates, setSelAffiliates] = useState([]);

    // Slider range filters
    const [likesRange, setLikesRange] = useState([0, 1000000]);
    const [sharesRange, setSharesRange] = useState([0, 1000000]);
    const [commentsRange, setCommentsRange] = useState([0, 1000000]);
    const [impressionsRange, setImpressionsRange] = useState([0, 1000000]);

    // Search and other filters
    const [searchQuery, setSearchQuery] = useState('');
    const [activePlatform, setActivePlatform] = useState('');

    // Single-select filters
    const [adSeen, setAdSeen] = useState('Anytime');
    const [postDate, setPostDate] = useState('Last 30 Days');
    const [domainAge, setDomainAge] = useState('All Ages');
    const [sortBy, setSortBy] = useState('');

    const totalActiveFilters =
        selCategories.length + selAdTypes.length + selCTAs.length +
        selCountries.length + selEcommerce.length + selFunnels.length +
        selAffiliates.length +
        (adSeen !== 'Anytime' ? 1 : 0) +
        (postDate !== 'Last 30 Days' ? 1 : 0) +
        (domainAge !== 'All Ages' ? 1 : 0) +
        (likesRange[0] !== 0 || likesRange[1] !== 1000000 ? 1 : 0) +
        (sharesRange[0] !== 0 || sharesRange[1] !== 1000000 ? 1 : 0) +
        (commentsRange[0] !== 0 || commentsRange[1] !== 1000000 ? 1 : 0) +
        (impressionsRange[0] !== 0 || impressionsRange[1] !== 1000000 ? 1 : 0);

    const clearAll = () => {
        setSelCategories([]);
        setSelAdTypes([]);
        setSelCTAs([]);
        setSelCountries([]);
        setSelEcommerce([]);
        setSelFunnels([]);
        setSelAffiliates([]);
        setAdSeen('Anytime');
        setPostDate('Last 30 Days');
        setDomainAge('All Ages');
        setLikesRange([0, 1000000]);
        setSharesRange([0, 1000000]);
        setCommentsRange([0, 1000000]);
        setImpressionsRange([0, 1000000]);
        setSearchQuery('');
        setActivePlatform('');
    };

    return {
        // Multi-select state + setters
        selCategories, setSelCategories,
        selAdTypes, setSelAdTypes,
        selCTAs, setSelCTAs,
        selCountries, setSelCountries,
        selEcommerce, setSelEcommerce,
        selFunnels, setSelFunnels,
        selAffiliates, setSelAffiliates,

        // Single-select state + setters
        adSeen, setAdSeen,
        postDate, setPostDate,
        domainAge, setDomainAge,

        // Slider range state + setters
        likesRange, setLikesRange,
        sharesRange, setSharesRange,
        commentsRange, setCommentsRange,
        impressionsRange, setImpressionsRange,

        // Search and other filters
        searchQuery, setSearchQuery,
        activePlatform, setActivePlatform,
        sortBy, setSortBy,

        // Derived
        totalActiveFilters,
        clearAll,
    };
};
