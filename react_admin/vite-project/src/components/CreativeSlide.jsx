import React, { useState, useEffect } from 'react';
import "./UserDetails.css"
import googleAds from "../assets/Social/Google-ads.png" 
import facebook from "../assets/Social/fb.png" 
import Google from "../assets/Social/Google.png" 
import Linkedin from "../assets/Social/Linkedin.png" 
import Pinterest from "../assets/Social/Pinterest.png" 
import Quora from "../assets/Social/Quora.png" 
import Reddit from "../assets/Social/Reddit.png" 

const CreativeSide = ({ selectedSession }) => {
  const [creativeData, setCreativeData] = useState([]);
  const [expandedStates, setExpandedStates] = useState({});

  useEffect(() => {
    if (!selectedSession) return;
    
    const newCreativeData = [];
    selectedSession.chats.forEach((chat, chatIndex) => {
      if (chat.adCreativeSide?.length > 0) {
        chat.adCreativeSide.forEach((creative) => {
          newCreativeData.push({
            ...creative,
            chatIndex: chatIndex + 1
          });
        });
      }
    });
    
    setCreativeData(newCreativeData);
    
    // Initialize expanded states
    const initialExpandedStates = {};
    newCreativeData.forEach((_, index) => {
      initialExpandedStates[index] = false;
    });
    setExpandedStates(initialExpandedStates);
  }, [selectedSession]);

  const toggleReadMore = (index) => {
    setExpandedStates(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  if (!selectedSession) return null;

  return (
    <div className="creative-side">
      {creativeData.length === 0 ? (
        <div className="no-interactions-card">
          <svg viewBox="0 0 24 24">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 12h2v5H7zm8-5h2v10h-2zm-4 7h2v3h-2zm0-4h2v2h-2z" />
          </svg>
          <h4>No creative side data recorded</h4>
          <p>This user didn't interact with any creative elements during this session.</p>
        </div>
      ) : (
        <div className="creative-grid">
          {creativeData.map((creative, index) => (
            <div key={index} className="creative-card">
              <div className="creative-header">
                <div>
                  <span className="chat-badge">Chat #{creative.chatIndex}</span>

                <span className="platform-badge">
                    {creative.platform === 'facebook' ? (
                      <img src={facebook} alt="Facebook" width="18" height="18" />
                    ) : creative.platform === 'meta' ? (
                      <img src="https://cdn.jsdelivr.net/npm/simple-icons@v8/icons/meta.svg" alt="Meta" width="12" height="12" />
                    ) : creative.platform === 'google search ads' || creative?.platform === 'google' ? (
                      <img src={Google} alt="Google" width="18" height="18" />
                    ):creative.platform === 'google_performance_max_ads' ? (
                      <img src={Google} alt="google_performance_max_ads" width="18" height="18" />
                    ) 
                    : creative.platform === 'google_display_ads' ? (
                      <img src={googleAds} alt="Google Display Ads" width="18" height="18" />
                    ) : creative.platform === 'linkedin' ? (
                      <img src={Linkedin} alt="LinkedIn" width="18" height="18" />
                    ) : creative.platform === 'twitter' ? (
                      <img src="https://cdn.jsdelivr.net/npm/simple-icons@v8/icons/twitter.svg" alt="Twitter Ads" width="12" height="12" />
                    ) : creative.platform === 'pinterest' ? (
                      <img src={Pinterest} alt="Pinterest Ads" width="18" height="18" />
                    ) : creative.platform === 'reddit' ? (
                      <img src={Reddit} alt="Reddit" width="18" height="18" />
                    ) : creative.platform === 'google_video_ads' ? (
                      <img src="https://cdn.jsdelivr.net/npm/simple-icons@v8/icons/youtube.svg" alt="Google Video Ads" width="12" height="12" />
                    ) : null}
                    {creative.platform}
                  </span>
                </div>
                <span className="timestamp">{formatDate(creative.timestamp)}</span>
              </div>
              
              <h4 className="creative-brand">
                <span className="brand-icon">
                  <svg viewBox="0 0 24 24">
                    <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                  </svg>
                </span>
                {creative.brandName}
              </h4>
              
              {creative.cta && (
                <div className="creative-cta">
                  <div className="cta-label">Call to Action</div>
                  <div className="cta-value">{creative.cta}</div>
                </div>
              )}
              
              {creative.brandDescription && (
                <div className="brand-description">
                  <div className="description-label">Brand Description</div>
                  <p className="description-text">
                    {creative.brandDescription.length > 300 && !expandedStates[index]
                      ? `${creative.brandDescription.substring(0, 300)}...` 
                      : creative.brandDescription}
                  </p>
                  {creative.brandDescription.length > 300 && (
                    <button 
                      className="read-more-btn" 
                      onClick={() => toggleReadMore(index)}
                    >
                      {expandedStates[index] ? 'Read less' : 'Read more'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CreativeSide;