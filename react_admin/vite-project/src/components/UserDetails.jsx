import React, { useState, useMemo,useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
} from '@tanstack/react-table';
import './UserDetails.css';
import { fetchUserDetails } from "../store/actions/adsgptActions";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import googleAds from "../assets/Social/Google-ads.png" 
import facebook from "../assets/Social/fb.png" 
import Google from "../assets/Social/Google.png" 
import Linkedin from "../assets/Social/Linkedin.png" 
import Pinterest from "../assets/Social/Pinterest.png" 
import Quora from "../assets/Social/Quora.png" 
import Reddit from "../assets/Social/Reddit.png" 
import AdImageGenerationReview from './AdImageGenerationReview ';
import CreativeSide from './CreativeSlide';
import AdCopySlide from './AdCopySlide';
import CreditDeductionModal from './CreditDeductionModal';
import UsageBarGraph from './UsageBarGraph';

const UserDetails = () => {  
  const { user_id } = useParams();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.adsgpt);

  const userData = user;
  const [selectedSession, setSelectedSession] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('interactions');
  const [globalFilter, setGlobalFilter] = useState('');
  const [sessionFilters, setSessionFilters] = useState({
    date: '',
    sessionId: '',
    sortBy: 'date-desc', // date-asc, date-desc, interactions-asc, interactions-desc
  });

  const [showCalendar, setShowCalendar] = useState(false);
const [currentMonth, setCurrentMonth] = useState(new Date());

// Handle calendar navigation
const handleCalendarNavigation = (direction) => {
  setCurrentMonth(prev => {
    const newDate = new Date(prev);
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    return newDate;
  });
};

// Handle date selection from calendar
const handleDateSelect = (date) => {
  handleFilterChange('date', date);
  setShowCalendar(false);
};

// Generate calendar days for the current month
const generateCalendarDays = () => {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  
  // First day of the month
  const firstDay = new Date(year, month, 1);
  // Last day of the month
  const lastDay = new Date(year, month + 1, 0);
  
  // Days from previous month to show
  const startDay = firstDay.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Total days to show (6 weeks)
  const totalDays = 42;
  
  const days = [];
  
  // Previous month days
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = startDay - 1; i >= 0; i--) {
    const day = prevMonthLastDay - i;
    const formattedDate = `${day.toString().padStart(2, '0')}/${(month).toString().padStart(2, '0')}/${year}`;
    days.push({
      day: day,
      date: formattedDate,
      isCurrentMonth: false
    });
  }
  
  // Current month days
  for (let i = 1; i <= lastDay.getDate(); i++) {
    const formattedDate = `${i.toString().padStart(2, '0')}/${(month + 1).toString().padStart(2, '0')}/${year}`;
    days.push({
      day: i,
      date: formattedDate,
      isCurrentMonth: true
    });
  }
  
  // Next month days
  const remainingDays = totalDays - days.length;
  for (let i = 1; i <= remainingDays; i++) {
    const formattedDate = `${i.toString().padStart(2, '0')}/${(month + 2).toString().padStart(2, '0')}/${year}`;
    days.push({
      day: i,
      date: formattedDate,
      isCurrentMonth: false
    });
  }
  
  return days;
};

// Close calendar when clicking outside
useEffect(() => {
  const handleClickOutside = (event) => {
    if (showCalendar && !event.target.closest('.date-picker-container')) {
      setShowCalendar(false);
    }
  };

  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [showCalendar]);
  const [showFilters, setShowFilters] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  useEffect(() => {
    if (user_id) dispatch(fetchUserDetails(user_id));
  }, [dispatch, user_id]);

  const countInteractions = (session) => {
    let clicks = 0;
    let hovers = 0;
    let copies = 0;
    let adCopySide = 0;
    let adCreativeSide = 0;
    let scrolls = 0;
    let adImageGenerationReview = 0;
    
    session?.chats?.forEach(chat => {
      if (chat?.clicks?.[0]) clicks += Object?.keys(chat?.clicks[0])?.length;
      if (chat?.hover) hovers += chat?.hover?.length;
      if (chat?.copy?.[0]) copies += Object?.keys(chat?.copy[0])?.length;
      if (chat?.adCopySide) adCopySide +=chat?.adCopySide?.length;
      if (chat?.adCreativeSide) adCreativeSide += chat?.adCreativeSide?.length;
      if (chat?.adImageGenerationReview[0]) adImageGenerationReview += Object?.keys(chat?.adImageGenerationReview[0])?.length;
      if (chat?.scroll[0]) scrolls += Object?.keys(chat?.scroll[0])?.length;
    });
    
    return { clicks, hovers, copies, scrolls, adCopySide, adCreativeSide,adImageGenerationReview };
  };
  
  if (!userData) {
    return (
      <div className="error-container">
        <div className="error-card">
          <svg className="error-icon" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <h2>No User Data Available</h2>
          <p>Please check the user ID or try again later.</p>
        </div>
      </div>
    );
  }

  const { user_name, user_email, sessions, createdAt, updatedAt } = userData;

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date?.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Filter and sort sessions based on filters
  const filteredSessions = useMemo(() => {
    if (!sessions) return [];
    
    let filtered = [...sessions];
    
    // Filter by date
    if (sessionFilters.date) {
      filtered = filtered.filter(session => 
        session.sessionDate === sessionFilters.date
      );
    }
    
    // Filter by session ID
    if (sessionFilters.sessionId) {
      const searchTerm = sessionFilters.sessionId.toLowerCase();
      filtered = filtered.filter(session => 
        session.sessionId?.toLowerCase().includes(searchTerm)
      );
    }
    
    // Sort sessions
    switch (sessionFilters.sortBy) {
      case 'date-asc':
        filtered.sort((a, b) => new Date(a.sessionDate.split('/').reverse().join('-')) - new Date(b.sessionDate.split('/').reverse().join('-')));
        break;
      case 'date-desc':
        filtered.sort((a, b) => new Date(b.sessionDate.split('/').reverse().join('-')) - new Date(a.sessionDate.split('/').reverse().join('-')));
        break;
      case 'interactions-asc':
        filtered.sort((a, b) => {
          const aInteractions = countInteractions(a).clicks + countInteractions(a).hovers + countInteractions(a).copies;
          const bInteractions = countInteractions(b).clicks + countInteractions(b).hovers + countInteractions(b).copies;
          return aInteractions - bInteractions;
        });
        break;
      case 'interactions-desc':
        filtered.sort((a, b) => {
          const aInteractions = countInteractions(a).clicks + countInteractions(a).hovers + countInteractions(a).copies;
          const bInteractions = countInteractions(b).clicks + countInteractions(b).hovers + countInteractions(b).copies;
          return bInteractions - aInteractions;
        });
        break;
      default:
        break;
    }
    
    return filtered;
  }, [sessions, sessionFilters]);

  // Get unique dates for the filter dropdown
  const uniqueDates = useMemo(() => {
    if (!sessions) return [];
    const dates = sessions.map(session => session.sessionDate).filter(Boolean);
    return [...new Set(dates)].sort((a, b) => 
      new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-'))
    );
  }, [sessions]);

  const openSessionDetails = (session) => {
    setSelectedSession(session);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedSession(null);
    setActiveTab('interactions');
    setGlobalFilter('');
  };

  const handleFilterChange = (filterName, value) => {
    setSessionFilters(prev => ({
      ...prev,
      [filterName]: value
    }));
  };

  const clearFilters = () => {
    setSessionFilters({
      date: '',
      sessionId: '',
      sortBy: 'date-desc',
    });
  };

  // React Table configuration for clicks
  const clicksColumns = useMemo(() => [
    {
      header: 'Ad ID',
      accessorKey: 'adId',
      size: 120,
    },
    {
      header: 'Component',
      accessorKey: 'component',
      size: 120,
    },
    {
      header: 'Network',
      accessorKey: 'network',
      size: 100,
      cell: info => info?.getValue() || 'N/A',
    },
    {
      header: 'Post Owner',
      accessorKey: 'postOwner',
      size: 120,
      cell: info => info?.getValue() || 'N/A',
    },
    {
      header: 'Count',
      accessorKey: 'count',
      size: 80,
    },
    {
      header: 'Target',
      accessorKey: 'target',
      size: 80,
      cell: info => {
        const value = info?.getValue();
        if (!value) return 'N/A';
        if (typeof value === 'object') {
          return value?.tagName || value?.id || JSON?.stringify(value);
        }
        return value;
      },
    },
    {
      header: 'Last Timestamp',
      accessorKey: 'lastTimestamp',
      cell: info => formatDate(info?.getValue()),
      size: 160,
    },
  ], []);

  const clicksData = useMemo(() => {
    if (!selectedSession) return [];
    
    const allClicks = [];
    
    selectedSession?.chats?.forEach((chat, chatIndex) => {
      if (chat?.clicks?.[0]) {
        Object?.entries(chat?.clicks[0])?.forEach(([key, clickData]) => {
          allClicks?.push({
            ...clickData,
            chatIndex: chatIndex + 1
          });
        });
      }
    });
    
    return allClicks;
  }, [selectedSession]);

  const clicksTable = useReactTable({
    data: clicksData,
    columns: clicksColumns,
    state: {
      globalFilter,
    },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // React Table configuration for copies
  const copiesColumns = useMemo(() => [
    {
      header: 'Ad ID',
      accessorKey: 'adId',
      size: 120,
    },
    {
      header: 'Network',
      accessorKey: 'network',
      size: 100,
    },
    {
      header: 'component',
      accessorKey: 'component',
      size: 100,
    },
    {
      header: 'innerText',
      accessorKey: 'innerText',
      size: 100,
    },
    {
      header: 'target',
      accessorKey: 'target',
      size: 100,
    },
    {
      header: 'Post Owner',
      accessorKey: 'postOwner',
      size: 120,
    },
    {
      header: 'Copied Text',
      accessorKey: 'copiedText',
      cell: info => (
        <div className="copied-text-cell">
          {info?.getValue()?.map((text, i) => (
            <div key={i} className="copied-text">
              {text?.length > 100 ? `${text?.substring(0, 100)}...` : text}
            </div>
          ))}
        </div>
      ),
      size: 200,
    },
    {
      header: 'Count',
      accessorKey: 'count',
      size: 80,
    },
    {
      header: 'Last Timestamp',
      accessorKey: 'lastTimestamp',
      cell: info => formatDate(info?.getValue()),
      size: 160,
    },
  ], []);

  const copiesData = useMemo(() => {
    if (!selectedSession) return [];
    
    const allCopies = [];
    
    selectedSession?.chats?.forEach((chat, chatIndex) => {
      if (chat?.copy?.[0]) {
        Object?.entries(chat?.copy[0])?.forEach(([key, copyData]) => {
          allCopies?.push({
            ...copyData,
            chatIndex: chatIndex + 1
          });
        });
      }
    });
    
    return allCopies;
  }, [selectedSession]);

  const copiesTable = useReactTable({
    data: copiesData,
    columns: copiesColumns,
    state: {
      globalFilter,
    },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const renderInteractionDetails = () => {
    if (!selectedSession) return null;
  
    const interactions = countInteractions(selectedSession);
    const totalInteractions = interactions?.clicks + interactions?.hovers + interactions?.copies + interactions?.scrolls;
    
    // Calculate session duration in seconds
    const durationInSeconds = calculateSessionDuration(selectedSession);
    
    // Calculate interaction frequency
    let interactionFrequency = 'N/A';
    if (durationInSeconds > 0 && totalInteractions > 0) {
      const avgSecondsBetweenInteractions = Math?.round(durationInSeconds / totalInteractions);
      interactionFrequency = `Every ${avgSecondsBetweenInteractions}s`;
    }
    
    // Format duration for display
    let durationDisplay = 'N/A';
    if (durationInSeconds > 0) {
      const minutes = Math?.floor(durationInSeconds / 60);
      const seconds = Math?.floor(durationInSeconds % 60);
      durationDisplay = `${minutes}m ${seconds}s`;
    }
    
    return (
      <div className="interaction-details">
        <div className="interaction-summary">
          <h3>Interaction Summary</h3>
          <div className="summary-grid">
            <div className="summary-item">
              <div className="summary-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
                </svg>
              </div>
              <div className="summary-content">
                <span className="summary-count">{selectedSession?.chats?.length}</span>
                <span className="summary-label">Total Chats</span>
              </div>
            </div>
            <div className="summary-item">
              <div className="summary-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                </svg>
              </div>
              <div className="summary-content">
                <span className="summary-count">{interactions?.clicks}</span>
                <span className="summary-label">Total Clicks</span>
              </div>
            </div>
            {/* <div className="summary-item">
              <div className="summary-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                </svg>
              </div>
              <div className="summary-content">
                <span className="summary-count">{interactions.hovers}</span>
                <span className="summary-label">Total Hovers</span>
              </div>
            </div> */}
            <div className="summary-item">
              <div className="summary-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                </svg>
              </div>
              <div className="summary-content">
                <span className="summary-count">{interactions?.copies}</span>
                <span className="summary-label">Total Copies</span>
              </div>
            </div>
            <div className="summary-item">
              <div className="summary-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                </svg>
              </div>
              <div className="summary-content">
                <span className="summary-count">{interactions?.adCopySide}</span>
                <span className="summary-label">Total AdCopies</span>
              </div>
            </div>
            <div className="summary-item">
              <div className="summary-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                </svg>
              </div>
              <div className="summary-content">
                <span className="summary-count">{interactions?.adCreativeSide}</span>
                <span className="summary-label">Total AdCreatives</span>
              </div>
            </div>
            <div className="summary-item">
              <div className="summary-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M7 19h10V5H7v14zm4-6V8h2v5h3l-4 4-4-4h3z" />
                </svg>
              </div>
              <div className="summary-content">
                <span className="summary-count">{interactions?.scrolls}</span>
                <span className="summary-label">Total Scrolls</span>
              </div>
            </div>
            <div className="summary-item">
              <div className="summary-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M7 19h10V5H7v14zm4-6V8h2v5h3l-4 4-4-4h3z" />
                </svg>
              </div>
              <div className="summary-content">
                <span className="summary-count">{interactions?.adImageGenerationReview}</span>
                <span className="summary-label">Total ImageReview</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="detailed-interactions">
          <div className="interaction-header">
            <h3>Detailed Interactions</h3>
            <div className="search-filter">
              <input
                type="text"
                placeholder="Search interactions..."
                value={globalFilter}
                onChange={e => setGlobalFilter(e?.target?.value)}
              />
              <svg className="search-icon" viewBox="0 0 24 24">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
            </div>
          </div>
          
          <div className="interaction-tabs">
            <button 
              className={`tab-button ${activeTab === 'interactions' ? 'active' : ''}`}
              onClick={() => setActiveTab('interactions')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M4 13h6c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1zm0 8h6c.55 0 1-.45 1-1v-4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1zm10 0h6c.55 0 1-.45 1-1v-8c0-.55-.45-1-1-1h-6c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1zM13 4v4c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1h-6c-.55 0-1 .45-1 1z" />
              </svg>
              Overview
            </button>
            <button 
              className={`tab-button ${activeTab === 'clicks' ? 'active' : ''}`}
              onClick={() => setActiveTab('clicks')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
              </svg>
              Clicks ({interactions?.clicks})
            </button>
            {/* <button 
              className={`tab-button ${activeTab === 'hovers' ? 'active' : ''}`}
              onClick={() => setActiveTab('hovers')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
              </svg>
              Hovers ({interactions.hovers})
            </button> */}
            <button 
              className={`tab-button ${activeTab === 'copies' ? 'active' : ''}`}
              onClick={() => setActiveTab('copies')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
              </svg>
              Copies ({interactions?.copies})
            </button>
            <button 
              className={`tab-button ${activeTab === 'adCopy' ? 'active' : ''}`}
              onClick={() => setActiveTab('adCopy')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 12h2v5H7zm8-5h2v10h-2zm-4 7h2v3h-2zm0-4h2v2h-2z" />
              </svg>
              AdCopy Side
            </button>
            <button 
              className={`tab-button ${activeTab === 'creative' ? 'active' : ''}`}
              onClick={() => setActiveTab('creative')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 12h2v5H7zm8-5h2v10h-2zm-4 7h2v3h-2zm0-4h2v2h-2z" />
              </svg>
              Creative Side
            </button>
            <button 
              className={`tab-button ${activeTab === 'scroll' ? 'active' : ''}`}
              onClick={() => setActiveTab('scroll')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 12h2v5H7zm8-5h2v10h-2zm-4 7h2v3h-2zm0-4h2v2h-2z" />
              </svg>
              scroll Side
            </button>
            <button 
              className={`tab-button ${activeTab === 'imageReview' ? 'active' : ''}`}
              onClick={() => setActiveTab('imageReview')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 12h2v5H7zm8-5h2v10h-2zm-4 7h2v3h-2zm0-4h2v2h-2z" />
              </svg>
              ImageReview
            </button>
          </div>
          
          <div className="interaction-content">
            {activeTab === 'interactions' && (
              <div className="overview-content">
                {/* <div className="overview-metrics">
                  <div className="metric-card">
                    <h4>Session Duration</h4>
                    <p className="metric-value">24 min 36 sec</p>
                    <div className="metric-progress">
                      <div className="progress-bar" style={{ width: '78%' }}></div>
                    </div>
                  </div>
                  <div className="metric-card">
                    <h4>Engagement Rate</h4>
                    <p className="metric-value">{getEngagementLabel(calculateEngagementScore(selectedSession))}</p>
                    <div className="metric-progress">
                      <div className="progress-bar" style={{ width: `${calculateEngagementScore(selectedSession)}%` }}></div>
                    </div>
                  </div>
                  <div className="metric-card">
                    <h4>Interaction Frequency</h4>
                    <p className="metric-value">Every 42s</p>
                    <div className="metric-progress">
                      <div className="progress-bar" style={{ width: '65%' }}></div>
                    </div>
                  </div>
                </div> */}
              <div className="overview-metrics">
          <div className="metric-card">
            <h4>Session Duration</h4>
            <p className="metric-value">{durationDisplay}</p>
            <div className="metric-progress">
              <div className="progress-bar" style={{ width: '78%' }}></div>
            </div>
          </div>
          <div className="metric-card">
            <h4>Engagement Rate</h4>
            <p className="metric-value">High</p>
            <div className="metric-progress">
              <div className="progress-bar" style={{ width: '85%' }}></div>
            </div>
          </div>
          <div className="metric-card">
            <h4>Interaction Frequency</h4>
            <p className="metric-value">{interactionFrequency}</p>
            <div className="metric-progress">
              <div className="progress-bar" style={{ width: '65%' }}></div>
            </div>
          </div>
        </div>
                <div className="overview-chart">
                  <div className="chart-placeholder">
                    <svg viewBox="0 0 36 36" className="circular-chart">
                      <path className="circle-bg"
                        d="M18 2.0845
                          a 15.9155 15.9155 0 0 1 0 31.831
                          a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path className="circle-fill"
                        strokeDasharray="75, 100"
                        d="M18 2.0845
                          a 15.9155 15.9155 0 0 1 0 31.831
                          a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                    <p>Engagement Overview</p>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'clicks' && (
              <div className="table-container">
                <div className="table-wrapper">
                  <table className="interaction-table">
                    <thead>
                      {clicksTable?.getHeaderGroups()?.map(headerGroup => (
                        <tr key={headerGroup?.id}>
                          {headerGroup?.headers?.map(header => (
                            <th key={header?.id} style={{ width: header?.getSize() }}>
                              {flexRender(
                                header?.column?.columnDef?.header,
                                header?.getContext()
                              )}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                    <tbody>
                      {clicksTable?.getRowModel()?.rows?.length > 0 ? (
                        clicksTable?.getRowModel()?.rows?.map(row => (
                          <tr key={row?.id}>
                            {row?.getVisibleCells()?.map(cell => (
                              <td key={cell?.id}>
                                {flexRender(
                                  cell?.column?.columnDef?.cell,
                                  cell?.getContext()
                                )}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={clicksColumns?.length} className="no-interactions">
                            No click interactions recorded
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="table-pagination">
                  <button
                    onClick={() => clicksTable?.previousPage()}
                    disabled={!clicksTable?.getCanPreviousPage()}
                  >
                    Previous
                  </button>
                  <span>
                    Page{' '}
                    <strong>
                      {clicksTable?.getState()?.pagination?.pageIndex + 1} of{' '}
                      {clicksTable?.getPageCount()}
                    </strong>
                  </span>
                  <button
                    onClick={() => clicksTable?.nextPage()}
                    disabled={!clicksTable?.getCanNextPage()}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            {/* {activeTab === 'hovers' && renderHovers()} */}
            {activeTab === 'copies' && (
              <div className="table-container">
                <div className="table-wrapper">
                  <table className="interaction-table">
                    <thead>
                      {copiesTable?.getHeaderGroups()?.map(headerGroup => (
                        <tr key={headerGroup?.id}>
                          {headerGroup?.headers?.map(header => (
                            <th key={header?.id} style={{ width: header?.getSize() }}>
                              {flexRender(
                                header?.column?.columnDef?.header,
                                header?.getContext()
                              )}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                    <tbody>
                      {copiesTable?.getRowModel()?.rows?.length > 0 ? (
                        copiesTable?.getRowModel()?.rows?.map(row => (
                          <tr key={row?.id}>
                            {row?.getVisibleCells()?.map(cell => (
                              <td key={cell?.id}>
                                {flexRender(
                                  cell?.column?.columnDef?.cell,
                                  cell?.getContext()
                                )}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={copiesColumns?.length} className="no-interactions">
                            No copy interactions recorded
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="table-pagination">
                  <button
                    onClick={() => copiesTable?.previousPage()}
                    disabled={!copiesTable?.getCanPreviousPage()}
                  >
                    Previous
                  </button>
                  <span>
                    Page{' '}
                    <strong>
                      {copiesTable?.getState()?.pagination?.pageIndex + 1} of{' '}
                      {copiesTable?.getPageCount()}
                    </strong>
                  </span>
                  <button
                    onClick={() => copiesTable?.nextPage()}
                    disabled={!copiesTable?.getCanNextPage()}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            {activeTab === 'adCopy' && <AdCopySlide selectedSession={selectedSession|| []} />}
            {activeTab === 'creative' && <CreativeSide selectedSession={selectedSession|| []} />}
            {activeTab === 'scroll' && renderScrollData()}
            {activeTab==='imageReview'&&<AdImageGenerationReview selectedSession={selectedSession|| []} />}
          </div>
        </div>
      </div>
    );
  };

  const renderHovers = () => {
    if (!selectedSession) return null;
    
    const allHovers = [];
    
    selectedSession?.chats?.forEach((chat, chatIndex) => {
      if (chat?.hover?.[0]) {
        Object?.entries(chat?.hover[0])?.forEach(([key, hoverData]) => {
          allHovers?.push({
            ...hoverData,
            chatIndex: chatIndex + 1
          });
        });
      }
    });
    
    return (
      <div className="hover-list">
        {allHovers?.length === 0 ? (
          <div className="no-interactions-card">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
            </svg>
            <h4>No hover interactions recorded</h4>
            <p>This user didn't hover over any elements during this session.</p>
          </div>
        ) : (
          <div className="hover-grid">
            {allHovers?.map((hover, index) => (
              <div key={index} className="hover-card">
                <div className="hover-card-header">
                  <span className="chat-badge">Chat #{hover?.chatIndex}</span>
                  <div className="hover-stats">
                    <span className="stat-badge">
                      <svg viewBox="0 0 24 24">
                        <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                      </svg>
                      {hover?.count}
                    </span>
                    <span className="stat-badge">
                      <svg viewBox="0 0 24 24">
                        <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm-7 7H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4z" />
                      </svg>
                      {formatDate(hover?.lastTimestamp)}
                    </span>
                  </div>
                </div>
                <h4 className="hover-title">{hover?.title}</h4>
                
                {hover?.cards && (
                  <div className="hover-cards">
                    {Object?.entries(hover?.cards)?.map(([cardKey, card]) => (
                      <div key={cardKey} className="card-item">
                        <div className="card-label">{card?.caption}</div>
                        <div className="card-value">{card?.value}</div>
                      </div>
                    ))}
                  </div>
                )}
                
                {hover?.chartArr && (
                  <div className="chart-preview">
                    <div className="mini-chart">
                      {hover?.chartArr?.map((series, i) => (
                        <div key={i} className="chart-series">
                          <div className="chart-bar" style={{ height: `${Math?.min(100, series * 10)}%` }}></div>
                        </div>
                      ))}
                    </div>
                    <p>Chart data with {hover?.chartArr?.length} series</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const calculateSessionDuration = (session) => {
    if (!session?.chats || session?.chats?.length === 0) return 0;
    
    // Get all timestamps from the session
    const allTimestamps = [];
    
    session?.chats.forEach(chat => {
      // Check clicks
      if (chat?.clicks?.[0]) {
        Object?.values(chat?.clicks[0])?.forEach(click => {
          allTimestamps?.push(new Date(click?.timestamp)?.getTime());
          if (click?.lastTimestamp) {
            allTimestamps?.push(new Date(click?.lastTimestamp).getTime());
          }
        });
      }
      
      // Check hovers
      if (chat?.hover?.[0]) {
        Object?.values(chat?.hover[0])?.forEach(hover => {
          allTimestamps?.push(new Date(hover?.timestamp)?.getTime());
          if (hover?.lastTimestamp) {
            allTimestamps?.push(new Date(hover?.lastTimestamp).getTime());
          }
        });
      }
      
      // Check copies
      if (chat?.copy?.[0]) {
        Object?.values(chat?.copy[0])?.forEach(copy => {
          allTimestamps?.push(new Date(copy?.timestamp)?.getTime());
          if (copy?.lastTimestamp) {
            allTimestamps?.push(new Date(copy?.lastTimestamp)?.getTime());
          }
        });
      }
      
      // Check scrolls
      if (chat?.scroll?.[0]) {
        Object?.values(chat?.scroll[0])?.forEach(scroll => {
          if (scroll?.lastTimestamp) {
            allTimestamps?.push(new Date(scroll?.lastTimestamp).getTime());
          }
        });
      }
    });
    
    if (allTimestamps?.length === 0) return 0;
    
    // Find min and max timestamps
    const minTime = Math?.min(...allTimestamps);
    const maxTime = Math?.max(...allTimestamps);
    
    return (maxTime - minTime) / 1000; // Return duration in seconds
  };
  const getEngagementLabel = (score) => {
    if (score >= 80) return 'Excellent engagement (top 10%)';
    if (score >= 60) return 'High engagement (top 30%)';
    if (score >= 40) return 'Average engagement';
    return 'Low engagement';
  };
  const calculateEngagementScore = (session) => {
    if (!session) return 0;
    
    // Count interactions
    const { clicks, hovers, copies, scrolls } = countInteractions(session);
    
    // Define maximum typical values for normalization
    const maxValues = {
      clicks: 50,
      hovers: 30,
      copies: 20,
      scrolls: 100
    };
    
    // Normalize each metric to 0-100 scale
    const normalizedClicks = Math?.min(100, (clicks / maxValues?.clicks) * 100);
    const normalizedHovers = Math?.min(100, (hovers / maxValues?.hovers) * 100);
    const normalizedCopies = Math?.min(100, (copies / maxValues?.copies) * 100);
    const normalizedScrolls = Math?.min(100, (scrolls / maxValues?.scrolls) * 100);
    
    // Calculate weighted score
    const score = 
      (normalizedClicks * 0.4) + 
      (normalizedHovers * 0.3) + 
      (normalizedCopies * 0.2) + 
      (normalizedScrolls * 0.1);
    
    return Math.round(score);
  };

  const renderScrollData = () => {
    if (!selectedSession) return null;
  
    const scrollData = [];
    
    selectedSession?.chats?.forEach((chat) => {
      if (chat?.scroll?.length > 0) {
        chat?.scroll?.forEach((scroll) => {
          // Check if the scroll object has any properties
          if (scroll && Object?.keys(scroll)?.length > 0) {
            scrollData?.push(scroll);
          }
        });
      }
    });

    if (scrollData?.length === 0) {
      return (
        <div className="no-scroll-data">
          <div className="empty-state">
            <svg viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/>
              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
            <h4>No Scroll Data Available</h4>
            <p>This session doesn't contain any scroll interaction data.</p>
          </div>
        </div>
      );
    }
  
    return (
      <div className="scroll-data-container">
        <div className="scroll-data-header">
          <h3>
            <svg viewBox="0 0 24 24">
              <path d="M7 19h10V5H7v14zm4-6V8h2v5h3l-4 4-4-4h3z" />
            </svg>
            Scroll Behavior Analytics
          </h3>
          <div className="scroll-summary">
            <div className="summary-item">
              <span className="summary-value">{scrollData?.length}</span>
              <span className="summary-label">Scroll Sessions</span>
            </div>
            <div className="summary-item">
              <span className="summary-value">
                {Math?.max(...scrollData?.map(s => 
                  Math?.max(
                    s?.scrollAdContainer?.scrollCount || 0, 
                    s?.scrollChartContainer?.scrollCount || 0
                  )
                ))}
              </span>
              <span className="summary-label">Max Scroll Events</span>
            </div>
          </div>
        </div>
        <div className="scroll-sessions">
          {scrollData?.map((scroll, sessionIndex) => (
            <div key={sessionIndex} className="scroll-session">
              <div className="session-header">
                <span className="session-number">Scroll Session #{sessionIndex + 1}</span>
                <span className="session-stats">
                  <span className="stat-badge">
                    <svg viewBox="0 0 24 24">
                      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/>
                      <path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                    </svg>
                    {new Date(scroll?.timestamp)?.toLocaleTimeString()}
                  </span>
                </span>
              </div>
  
              <div className="scroll-containers">
                {/* Ad Container */}
                {scroll?.scrollAdContainer && (
                  <div className="scroll-container-card">
                    <div className="container-header">
                      <div className="container-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/>
                          <path d="M7 12h10v2H7z"/>
                        </svg>
                      </div>
                      <h4>Ad Container</h4>
                      <div className="container-stats">
                        <div className="stat">
                          <span className="stat-value">{scroll?.scrollAdContainer?.scrollCount}</span>
                          <span className="stat-label">Scrolls</span>
                        </div>
                        <div className="stat">
                          <span className="stat-value">{scroll?.scrollAdContainer?.totalPercentSeen}%</span>
                          <span className="stat-label">Seen</span>
                        </div>
                      </div>
                    </div>
  
                    <div className="scroll-visualization">
                      <div className="scroll-graphic">
                        <div className="scroll-track">
                          <div 
                            className="scroll-thumb"
                            style={{ 
                              top: `${100 - scroll?.scrollAdContainer?.totalPercentSeen}%`,
                              height: `${scroll?.scrollAdContainer?.clientHeight / scroll?.scrollAdContainer?.scrollHeight * 100}%`
                            }}
                          ></div>
                        </div>
                        <div className="scroll-metrics">
                          <div className="metric">
                            <span className="metric-label">Start</span>
                            <span className="metric-value">0px</span>
                          </div>
                          <div className="metric">
                            <span className="metric-label">Current</span>
                            <span className="metric-value">{scroll?.scrollAdContainer?.scrollTop}px</span>
                          </div>
                          <div className="metric">
                            <span className="metric-label">End</span>
                            <span className="metric-value">{scroll?.scrollAdContainer?.scrollHeight}px</span>
                          </div>
                        </div>
                      </div>
  
                      <div className="scroll-details">
                        <div className="detail-item">
                          <span className="detail-label">Viewport Height</span>
                          <span className="detail-value">{scroll?.scrollAdContainer?.clientHeight}px</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">New Ads Fetched</span>
                          <span className="detail-value">{scroll?.scrollAdContainer?.totalNewDataFetched}</span>
                        </div>
                      </div>
                    </div>
  
                    {scroll?.scrollAdContainer?.adId?.length > 0 && (
                      <div className="viewed-ads">
                        <h5>Viewed Ads</h5>
                        <div className="ad-grid">
                          {scroll?.scrollAdContainer?.adId?.map((adId, index) => (
                            <div key={index} className="ad-card">
                              <div className="ad-platform">
                                {adId?.includes('google') ? (
                                  <img src={Google} alt="Google" />
                                ) : (
                                  <img src={facebook} alt="Facebook" />
                                )}
                              </div>
                              <div className="ad-info">
                                <span className="ad-id">ID: {adId?.split('-')[0]}</span>
                                <span className="ad-type">{adId?.split('-')[1]}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
  
                {/* Chart Container */}
                {scroll?.scrollChartContainer && (
                  <div className="scroll-container-card">
                    <div className="container-header">
                      <div className="container-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/>
                        </svg>
                      </div>
                      <h4>Chart Container</h4>
                      <div className="container-stats">
                        <div className="stat">
                          <span className="stat-value">{scroll?.scrollChartContainer?.scrollCount}</span>
                          <span className="stat-label">Scrolls</span>
                        </div>
                        <div className="stat">
                          <span className="stat-value">{scroll?.scrollChartContainer?.totalPercentSeen}%</span>
                          <span className="stat-label">Seen</span>
                        </div>
                      </div>
                    </div>
  
                    <div className="scroll-visualization">
                      <div className="scroll-graphic">
                        <div className="scroll-track">
                          <div 
                            className="scroll-thumb"
                            style={{ 
                              top: `${100 - scroll?.scrollChartContainer?.totalPercentSeen}%`,
                              height: `${scroll?.scrollChartContainer?.clientHeight / scroll?.scrollChartContainer?.scrollHeight * 100}%`
                            }}
                          ></div>
                        </div>
                        <div className="scroll-metrics">
                          <div className="metric">
                            <span className="metric-label">Start</span>
                            <span className="metric-value">0px</span>
                          </div>
                          <div className="metric">
                            <span className="metric-label">Current</span>
                            <span className="metric-value">{scroll?.scrollChartContainer?.scrollTop}px</span>
                          </div>
                          <div className="metric">
                            <span className="metric-label">End</span>
                            <span className="metric-value">{scroll?.scrollChartContainer?.scrollHeight}px</span>
                          </div>
                        </div>
                      </div>
  
                      <div className="scroll-details">
                        <div className="detail-item">
                          <span className="detail-label">Viewport Height</span>
                          <span className="detail-value">{scroll?.scrollChartContainer?.clientHeight}px</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">New Data Fetched</span>
                          <span className="detail-value">{scroll?.scrollChartContainer?.totalNewDataFetched}</span>
                        </div>
                      </div>
                    </div>
  
                    {scroll?.scrollChartContainer?.adId?.length > 0 && (
                      <div className="viewed-ads">
                        <h5>Viewed Ads</h5>
                        <div className="ad-grid">
                          {scroll?.scrollChartContainer?.adId?.map((adId, index) => (
                            <div key={index} className="ad-card">
                              <div className="ad-platform">
                                {adId?.includes('google') ? (
                                  <img src={Google} alt="Google" />
                                ) : (
                                  <img src={facebook} alt="Facebook" />
                                )}
                              </div>
                              <div className="ad-info">
                                <span className="ad-id">ID: {adId?.split('-')[0]}</span>
                                <span className="ad-type">{adId?.split('-')[1]}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className="user-details-container">
      <header className="user-header">
        <div className="user-avatar">
          {user_name?.charAt(0)?.toUpperCase()}
        </div>
        <div className="user-info">
          <h1>{user_name}</h1>
          <div className="user-meta">
            <span className="user-id">ID: {user_id}</span>
            <span className="user-email">
              <svg viewBox="0 0 24 24">
                <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
              </svg>
              {user_email}
            </span>
          </div>
        </div>
        <div className="account-meta">
        <button 
          className="credit-analytics-btn"
          onClick={() => setShowCreditModal(true)}
        >
          <svg viewBox="0 0 24 24">
            <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
          </svg>
          Credit Analytics
        </button>
          <div className="meta-item">
            <span className="meta-label">Joined</span>
            <span className="meta-value">{formatDate(createdAt)}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Last Active</span>
            <span className="meta-value">{formatDate(updatedAt)}</span>
          </div>
        </div>
      </header>   

      <div className="graph-container">
        <UsageBarGraph userId={user_id} />
      </div>
      
      <div className="sessions-container">
        <div className="section-header">
          <h2>User Sessions</h2>
          <div className="session-stats">
            <span className="stat-item">
              <span className="stat-number">{filteredSessions.length}</span>
              <span className="stat-label">Filtered Sessions</span>
            </span>
            <span className="stat-item">
              <span className="stat-number">{sessions?.length}</span>
              <span className="stat-label">Total Sessions</span>
            </span>
            <button 
              className={`filter-toggle ${showFilters ? 'active' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
            >
              <svg viewBox="0 0 24 24">
                <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
              </svg>
              Filters
              {(sessionFilters.date || sessionFilters.sessionId) && (
                <span className="filter-badge">
                  {[sessionFilters.date, sessionFilters.sessionId].filter(Boolean).length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Advanced Filter Section */}
        {/* {showFilters && (
          <div className="advanced-filters">
            <div className="filter-header">
              <h3>Filter Sessions</h3>
              <button className="clear-filters" onClick={clearFilters}>
                Clear All
              </button>
            </div>
            
            <div className="filter-grid">
              <div className="filter-group">
                <label htmlFor="date-filter">Date</label>
                <div className="select-wrapper">
                  <select
                    id="date-filter"
                    value={sessionFilters.date}
                    onChange={(e) => handleFilterChange('date', e.target.value)}
                  >
                    <option value="">All Dates</option>
                    {uniqueDates.map(date => (
                      <option key={date} value={date}>{date}</option>
                    ))}
                  </select>
                  <svg className="select-arrow" viewBox="0 0 24 24">
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
                </div>
              </div>
              
              <div className="filter-group">
                <label htmlFor="session-id-filter">Session ID</label>
                <input
                  id="session-id-filter"
                  type="text"
                  placeholder="Search by session ID..."
                  value={sessionFilters.sessionId}
                  onChange={(e) => handleFilterChange('sessionId', e.target.value)}
                />
              </div>
              
              <div className="filter-group">
                <label htmlFor="sort-filter">Sort By</label>
                <div className="select-wrapper">
                  <select
                    id="sort-filter"
                    value={sessionFilters.sortBy}
                    onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                  >
                    <option value="date-desc">Date (Newest First)</option>
                    <option value="date-asc">Date (Oldest First)</option>
                    <option value="interactions-desc">Interactions (High to Low)</option>
                    <option value="interactions-asc">Interactions (Low to High)</option>
                  </select>
                  <svg className="select-arrow" viewBox="0 0 24 24">
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
                </div>
              </div>
            </div>
            
            <div className="active-filters">
              {sessionFilters.date && (
                <span className="active-filter">
                  Date: {sessionFilters.date}
                  <button onClick={() => handleFilterChange('date', '')}>
                    <svg viewBox="0 0 24 24">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </span>
              )}
              {sessionFilters.sessionId && (
                <span className="active-filter">
                  Session ID: {sessionFilters.sessionId}
                  <button onClick={() => handleFilterChange('sessionId', '')}>
                    <svg viewBox="0 0 24 24">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </span>
              )}
            </div>
          </div>
        )} */}
        {/* Advanced Filter Section */}
{showFilters && (
  <div className="advanced-filters">
    <div className="filter-header flex justify-between">
      <h3>Filter Sessions</h3>
      <button className="clear-filters" onClick={clearFilters}>
        Clear All
      </button>
    </div>
    
    <div className="filter-grid">
      {/* Date Filter with Calendar */}
      <div className="filter-group">
        <label htmlFor="date-filter">Date</label>
        <div className="date-picker-container">
          <div className="date-input-wrapper">
            <input
              id="date-filter"
              type="text"
              placeholder="Select date or choose from calendar"
              value={sessionFilters.date}
              onChange={(e) => handleFilterChange('date', e.target.value)}
              className="date-input"
            />
            <button 
              className="calendar-toggle"
              onClick={() => setShowCalendar(!showCalendar)}
            >
              <svg viewBox="0 0 24 24">
                <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V9h14v10zM5 7V5h14v2H5z"/>
              </svg>
            </button>
          </div>
          
          {showCalendar && (
            <div className="calendar-popup">
              <div className="calendar-header">
                <button 
                  className="calendar-nav prev"
                  onClick={() => handleCalendarNavigation('prev')}
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                  </svg>
                </button>
                <span className="calendar-month">
                  {currentMonth.toLocaleString('default', { month: 'long' })} {currentMonth.getFullYear()}
                </span>
                <button 
                  className="calendar-nav next"
                  onClick={() => handleCalendarNavigation('next')}
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                  </svg>
                </button>
              </div>
              
              <div className="calendar-grid">
                <div className="calendar-weekdays">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="calendar-weekday">{day}</div>
                  ))}
                </div>
                
                <div className="calendar-days">
                  {generateCalendarDays().map((day, index) => (
                    <button
                      key={index}
                      className={`calendar-day ${day.isCurrentMonth ? '' : 'other-month'} ${day.date === sessionFilters.date ? 'selected' : ''}`}
                      onClick={() => handleDateSelect(day.date)}
                      disabled={!day.isCurrentMonth}
                    >
                      {day.day}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="calendar-actions">
                <button 
                  className="calendar-action-btn"
                  onClick={() => {
                    handleFilterChange('date', '');
                    setShowCalendar(false);
                  }}
                >
                  Clear
                </button>
                <button 
                  className="calendar-action-btn primary"
                  onClick={() => setShowCalendar(false)}
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="filter-group">
        <label htmlFor="session-id-filter">Session ID</label>
        <input
          id="session-id-filter"
          type="text"
          placeholder="Search by session ID..."
          value={sessionFilters.sessionId}
          onChange={(e) => handleFilterChange('sessionId', e.target.value)}
        />
      </div>
      
      <div className="filter-group">
        <label htmlFor="sort-filter">Sort By</label>
        <div className="select-wrapper">
          <select
            id="sort-filter"
            value={sessionFilters.sortBy}
            onChange={(e) => handleFilterChange('sortBy', e.target.value)}
          >
            <option value="date-desc">Date (Newest First)</option>
            <option value="date-asc">Date (Oldest First)</option>
            <option value="interactions-desc">Interactions (High to Low)</option>
            <option value="interactions-asc">Interactions (Low to High)</option>
          </select>
          
        </div>
      </div>
    </div>
    
    <div className="active-filters">
      {sessionFilters.date && (
        <span className="active-filter">
          Date: {sessionFilters.date}
          <button onClick={() => handleFilterChange('date', '')}>
            <svg viewBox="0 0 24 24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </span>
      )}
      {sessionFilters.sessionId && (
        <span className="active-filter">
          Session ID: {sessionFilters.sessionId}
          <button onClick={() => handleFilterChange('sessionId', '')}>
            <svg viewBox="0 0 24 24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </span>
      )}
    </div>
  </div>
)}
        <div className="sessions-grid">
          {filteredSessions.length === 0 ? (
            <div className="no-sessions">
              <svg viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z" />
              </svg>
              <h3>No Sessions Match Your Filters</h3>
              <p>Try adjusting your filters or clear them to see all sessions.</p>
              <button className="clear-filters-btn" onClick={clearFilters}>
                Clear Filters
              </button>
            </div>
          ) : (
            filteredSessions.map((session, index) => {
              const interactions = countInteractions(session);
              
              return (
                <div key={index} className="session-card">
                  <div className="session-header">
                    <h3>Session {index + 1}</h3>
                    <span className="session-date">{session?.sessionDate}</span>
                  </div>
                  <div className="session-page">
                    <div className="page-info">
                      <svg viewBox="0 0 24 24">
                        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                      </svg>
                      <div>
                        <p className="page-path">: {session?.pageLocation !== null ? session?.pageLocation?.path : 'Unknown page'}</p>
                      </div>
                    </div>
                    <div className="page-info">
                      <p className="page-time"> SessionId : {session?.sessionId !== null ? session?.sessionId : ""}</p>
                    </div>
                  </div>
                  
                  <div className="interaction-stats">
                    <div className="stat">
                      <div className="stat-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
                        </svg>
                      </div>
                      <div className="stat-content">
                        <span className="stat-number">{session?.chats?.length}</span>
                        <span className="stat-label">Chats</span>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="stat-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                        </svg>
                      </div>
                      <div className="stat-content">
                        <span className="stat-number">{interactions?.clicks}</span>
                        <span className="stat-label">Clicks</span>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="stat-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                        </svg>
                      </div>
                      <div className="stat-content">
                        <span className="stat-number">{interactions?.adCopySide}</span>
                        <span className="stat-label">AdCopy</span>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="stat-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                        </svg>
                      </div>
                      <div className="stat-content">
                        <span className="stat-number">{interactions?.adCreativeSide}</span>
                        <span className="stat-label">AdCreative</span>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="stat-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                        </svg>
                      </div>
                      <div className="stat-content">
                        <span className="stat-number">{interactions?.adImageGenerationReview}</span>
                        <span className="stat-label">Image Review</span>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="stat-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                        </svg>
                      </div>
                      <div className="stat-content">
                        <span className="stat-number">{interactions?.scrolls}</span>
                        <span className="stat-label">Scrolls</span>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="stat-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                        </svg>
                      </div>
                      <div className="stat-content">
                        <span className="stat-number">{interactions?.copies}</span>
                        <span className="stat-label">Copies</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="session-actions">
                    <button 
                      className="view-details-btn"
                      onClick={() => openSessionDetails(session)}
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                      </svg>
                      View Details
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      
      {/* Modal code remains the same */}
      {isModalOpen && selectedSession && (
          <div className="modal-overlay">
    <div className="modal-content">
      <div className="modal-header">
        <div className="modal-header-content">
          <h2>Session Details</h2>
          <p className="session-subtitle">
            <span className="session-id">ID: {selectedSession?.sessionId}</span>
            <span className="session-date-badge">
              <svg viewBox="0 0 24 24">
                <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V9h14v10zM5 7V5h14v2H5zm2 4h10v2H7zm0 4h7v2H7z"/>
              </svg>
              {formatDate(selectedSession?.sessionDate)}
            </span>
          </p>
        </div>
        <button className="close-modal" onClick={closeModal}>
          <svg viewBox="0 0 24 24">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>
      
      <div className="modal-body">
        <div className="session-meta-grid">
          <div className="meta-card">
            <div className="meta-card-icon">
              <svg viewBox="0 0 24 24">
                <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
              </svg>
            </div>
            <div className="meta-card-content">
              <h4>Page Location</h4>
              <p className="meta-card-value">
                {selectedSession.pageLocation?.path || 'Unknown page'}
              </p>
              <p className="meta-card-label">
                Entered at {formatDate(selectedSession?.pageLocation?.enterTime)}
              </p>
            </div>
          </div>
          
          <div className="meta-card">
            <div className="meta-card-icon">
              <svg viewBox="0 0 24 24">
                <path d="M13 2.05v3.03c3.39.49 6 3.39 6 6.92 0 .9-.18 1.75-.5 2.54l2.62 1.53c.56-1.24.88-2.62.88-4.07 0-5.18-3.95-9.45-9-9.95zM12 19c-3.87 0-7-3.13-7-7 0-3.53 2.61-6.43 6-6.92V2.05c-5.06.5-9 4.76-9 9.95 0 5.52 4.47 10 9.99 10 3.31 0 6.24-1.61 8.06-4.09l-2.6-1.53C16.17 17.98 14.21 19 12 19z"/>
              </svg>
            </div>
            <div className="meta-card-content">
              <h4>Session Date</h4>
              <p className="meta-card-value">{formatDate(selectedSession?.sessionDate)}</p>
              {/* <p className="meta-card-label">Average for this user: 18 min</p> */}
            </div>
          </div>
          
          {/* <div className="meta-card">
            <div className="meta-card-icon">
              <svg viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm4.59-12.42L10 14.17l-2.59-2.58L6 13l4 4 8-8z"/>
              </svg>
            </div>
            <div className="meta-card-content">
              <h4>Engagement Score</h4>
              <div className="engagement-meter">
                <div className="engagement-progress" style={{ width: '78%' }}></div>
              </div>
              <p className="meta-card-label">Higher than 85% of sessions</p>
            </div>
          </div> */}

          <div className="meta-card">
            <div className="meta-card-icon">
              <svg viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm4.59-12.42L10 14.17l-2.59-2.58L6 13l4 4 8-8z"/>
              </svg>
            </div>
            <div className="meta-card-content">
              <h4>Engagement Score</h4>
              <div className="engagement-meter">
                <div 
                  className="engagement-progress" 
                  style={{ width: `${calculateEngagementScore(selectedSession)}%` }}
                ></div>
              </div>
              <p className="meta-card-label">
                {getEngagementLabel(calculateEngagementScore(selectedSession))}
              </p>
            </div>
          </div>
          
          {/* <div className="meta-card">
            <div className="meta-card-icon">
              <svg viewBox="0 0 24 24">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
              </svg>
            </div>
            <div className="meta-card-content">
              <h4>User Context</h4>
              <p className="meta-card-value">Returning Visitor</p>
              <p className="meta-card-label">3rd session this week</p>
            </div>
          </div> */}
        </div>
        
        {renderInteractionDetails()}
      </div>
      
      <div className="modal-footer">
        <div className="footer-actions">
            <button className="close-btn" onClick={closeModal}>
              Close
            </button>  
        </div>
      </div>
    </div>
  </div>
      )}
     {showCreditModal&&
     <CreditDeductionModal
     user={userData}
     isOpen={showCreditModal}
     onClose={() => setShowCreditModal(false)}
     />
     } 
    </div>
  );
};

export default UserDetails;