import React, { useState } from 'react';
import { FaThumbsUp, FaThumbsDown, FaDownload, FaBookmark } from 'react-icons/fa';
import { MdTextFields, MdImage } from 'react-icons/md';
import './UserDetails.css';
const AdImageGenerationReview = ({ selectedSession }) => {
  const [expandedReview, setExpandedReview] = useState(null);

  if (!selectedSession) return null;
  
  const reviews = [];

// Iterate through each object in the main array
selectedSession?.chats?.forEach((sessionData) => {
  if (sessionData?.adImageGenerationReview?.length > 0) {
    sessionData?.adImageGenerationReview?.forEach((review) => {
      Object.keys(review).forEach((key)=>{
        const adCopy = review[key];   
  
        if (adCopy && typeof adCopy === 'object') {
          reviews.push(adCopy);
        }
      })
    })
}
});
 
  if (!reviews || reviews?.length === 0) {
    return (
      <div className="no-reviews-container">
        <div className="no-reviews-card">
          <MdImage className="no-reviews-icon" />
          <h4>No Ad Image Reviews Yet</h4>
          <p>This user hasn't reviewed any generated ad images in this session.</p>
        </div>
      </div>
    );
  }

  const toggleExpand = (index) => {
    if (expandedReview === index) {
      setExpandedReview(null);
    } else {
      setExpandedReview(index);
    }
  };

  return (
    <div className="ad-image-review-container">
      <div className="review-header">
        <h3>
          <MdImage className="header-icon" />
          Ad Image Generation Reviews
        </h3>
        <p className="subtitle">{reviews?.length} generated ads reviewed</p>
      </div>

      <div className="review-grid">
        {reviews?.map((reviewObj, index) => {
          // const reviewKey = reviewObj;
          const review = reviewObj;
          
          return (
            <div 
              key={index} 
              className={`review-card ${expandedReview === index ? 'expanded' : ''}`}
            >
              <div className="card-header" onClick={() => toggleExpand(index)}>
                <div className="header-left">
                  <div className={`status-badge ${review?.like ? 'liked' : review?.dislike ? 'disliked' : 'neutral'}`}>
                    {review?.like ? (
                      <FaThumbsUp className="status-icon" />
                    ) : review?.dislike ? (
                      <FaThumbsDown className="status-icon" />
                    ) : (
                      <span className="neutral-icon">?</span>
                    )}
                  </div>
                  <div className="header-text">
                    <h4>Ad Review #{index + 1}</h4>
                    <p className="timestamp">
                      {new Date(review?.timestamp || new Date())?.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="expand-toggle">
                  {expandedReview === index ? '▲' : '▼'}
                </div>
              </div>

              <div className={`card-content ${expandedReview === index ? 'visible' : ''}`}>
                <div className="image-section">
                  <div className="image-container">
                    {review?.imgURl ? (
                      <img 
                        src={`https://contents.adsgpt.io${review?.imgURl}`} 
                        alt="Generated ad" 
                        className="ad-image"
                        // onError={(e) => {
                        //   e.target.src = 'https://via.placeholder.com/300x200?text=Image+Not+Available';
                        // }}
                      />
                    ) : (
                      <div className="image-placeholder">
                        <MdImage className="placeholder-icon" />
                        <p>No image available</p>
                      </div>
                    )}
                  </div>
                  <div className="image-actions">
                    <button 
                      className={`action-btn ${review?.download ? 'active' : ''}`}
                      title={review?.download ? 'Downloaded' : 'Not downloaded'}
                    >
                      <FaDownload />
                    </button>
                    <button 
                      className={`action-btn ${review?.save ? 'active' : ''}`}
                      title={review?.save ? 'Saved' : 'Not saved'}
                    >
                      <FaBookmark />
                    </button>
                  </div>
                </div>

                <div className="text-section">
                  <div className="text-group">
                    <div className="text-header">
                      <MdTextFields className="text-icon" />
                      <h5>Primary Text</h5>
                    </div>
                    <div className="text-content">
                      {review?.text ? (
                        <p>{review?.text?.split('\n')?.map((line, i) => (
                          <React.Fragment key={i}>
                            {line}
                            <br />
                          </React.Fragment>
                        ))}</p>
                      ) : (
                        <p className="no-text">No primary text provided</p>
                      )}
                    </div>
                  </div>

                  <div className="metadata">
                    <div className="meta-item">
                      <span className="meta-label">Session ID:</span>
                      <span className="meta-value">{review?.adcopysessionID || 'N/A'}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Image Url:</span>
                      <span className="meta-value">{review?.imgURl || 'N/A'}</span>
                    </div>
                    {/* <div className="meta-item">
                      <span className="meta-label">User ID:</span>
                      <span className="meta-value">{review?.replace('null', '') || 'N/A'}</span>
                    </div> */}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};



export default AdImageGenerationReview;