import React, { useState, useEffect, useMemo } from 'react';
import './CreditDeductionModal.css';
import { RiGeminiFill } from 'react-icons/ri';
import { SiOpenai } from 'react-icons/si';
import SparkleDark from '../assets/img/sparkle-dark.svg'; // Update path as needed
import advideo from '../assets/img/advideo.svg'; 
import addie from '../assets/img/addie.svg'; 
import adcopy from '../assets/img/adcopy.svg'; 
const ADSGPT_URL = import.meta.env.VITE_ADSGPT_BACKEND;
const CreditDeductionModal = ({ user, isOpen, onClose }) => {
  const [creditData, setCreditData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [isClosing, setIsClosing] = useState(false);

  const chatModels = useMemo(
    () => [
      {
        value: 'ADSGPT-2.0',
        label: 'Nano-Banana',
        Icon: <RiGeminiFill className="model-icon" />,
      },
      {
        value: 'ADSGPT-3.0',
        label: 'OpenAI',
        Icon: <SiOpenai className="model-icon" />,
      },
      {
        value: 'ADSGPT-1.0',
        label: 'Imagen',
        Icon: <img src={SparkleDark} className="model-icon" />,
      },
      {
        value: 'ADSGPT-VIDEO',
        label: 'AD-VIDEO(Credit deduction based on duration)',
        Icon: <img src={advideo} className="model-icon" />,
      },
      {
        value: 'ADSGPT-CHAT',
        label: 'AD-INSIGHTS',
        Icon: <img src={addie} className="model-icon" />,
      },
      {
        value: 'ADSGPT-TEXT',
        label: 'AD-COPY',
        Icon: <img src={adcopy} className="model-icon" />,
      }
    ],
    []
  );

  useEffect(() => {
    if (isOpen && user) {
      fetchCreditData();
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, user]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 300);
  };
  
  const fetchCreditData = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${ADSGPT_URL}/adsgpt/user-credit-data/models/${user.user_id}/basic`);
      const data = await response.json();
      setCreditData(data.data);
    } catch (error) {
      console.error('Error fetching credit data:', error);
    }
    setLoading(false);
  };

  if (!isOpen && !isClosing) return null;

  const getModelConfig = (modelValue) => {
    return chatModels.find(model => model.value === modelValue) || {
      value: modelValue,
      label: modelValue,
      Icon: '🔹'
    };
  };

  const getModelColor = (modelValue) => {
    const colors = {
      'ADSGPT-3.0': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'ADSGPT-2.0': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'ADSGPT-1.0': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'ADSGPT-VIDEO': 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'ADSGPT-TEXT': 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'ADSGPT-CHAT': 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)'
    };
    return colors[modelValue] || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  };

  const getModelIcon = (modelValue) => {
    const modelConfig = getModelConfig(modelValue);
    return modelConfig.Icon;
  };

  const getModelLabel = (modelValue) => {
    const modelConfig = getModelConfig(modelValue);
    return modelConfig.label;
  };

  const AnimatedPieChart = ({ data }) => {
    const [animationProgress, setAnimationProgress] = useState(0);

    useEffect(() => {
      const timer = setTimeout(() => setAnimationProgress(1), 100);
      return () => clearTimeout(timer);
    }, []);

    let currentAngle = 0;
    
    return (
      <div className="credit-deduction-pie-chart-container">
        <div className="credit-deduction-pie-chart">
          {data?.models?.map((model, index) => {
            const percentage = parseFloat(model.percentage);
            const segmentAngle = (percentage * 3.6) * animationProgress;
            const segment = (
              <div
                key={model.model}
                className="credit-deduction-pie-segment"
                style={{
                  background: getModelColor(model.model),
                  transform: `rotate(${currentAngle}deg)`,
                  clipPath: `conic-gradient(from 0deg at 50% 50%, transparent 0deg ${segmentAngle}deg, transparent ${segmentAngle}deg 360deg)`
                }}
              />
            );
            currentAngle += segmentAngle;
            return segment;
          })}
          <div className="credit-deduction-pie-center">
            <span className="credit-deduction-total-credits">{data?.total_credits_all_models || 0}</span>
            <small>Total Credits</small>
          </div>
        </div>
      </div>
    );
  };

  const renderOverview = () => (
    <div className="credit-deduction-overview-content">
      <div className="credit-deduction-stats-grid">
        <div className="credit-deduction-stat-card credit-deduction-glass">
          <div className="credit-deduction-stat-icon">💰</div>
          <div className="credit-deduction-stat-content">
            <h3>{creditData?.total_credits_all_models || 0}</h3>
            <p>Total Credits Used</p>
            {/* <div className="credit-deduction-stat-trend up">+12%</div> */}
          </div>
        </div>
        
        <div className="credit-deduction-stat-card credit-deduction-glass">
          <div className="credit-deduction-stat-icon">AI</div>
          <div className="credit-deduction-stat-content">
            <h3>{creditData?.models?.length || 0}</h3>
            <p>Models Used</p>
            {/* <div className="credit-deduction-stat-trend neutral">±0%</div> */}
          </div>
        </div>
        
        <div className="credit-deduction-stat-card credit-deduction-glass">
          <div className="credit-deduction-stat-icon">📈</div>
          <div className="credit-deduction-stat-content">
            <h3>
              {creditData?.models?.length ? 
                Math.round(creditData.models.reduce((sum, model) => sum + model.credits_deducted, 0) / creditData.models.length) 
                : 0
              }
            </h3>
            <p>Avg Credits/Model</p>
            {/* <div className="credit-deduction-stat-trend down">-5%</div> */}
          </div>
        </div>

        <div className="credit-deduction-stat-card credit-deduction-glass">
          <div className="credit-deduction-stat-icon">⚡</div>
          <div className="credit-deduction-stat-content">
            <h3>N/A</h3>
            <p>Efficiency Score</p>
            {/* <div className="credit-deduction-stat-trend up">+8%</div> */}
          </div>
        </div>
      </div>

      <div className="credit-deduction-charts-section">
        <div className="credit-deduction-chart-card credit-deduction-glass">
          <div className="credit-deduction-chart-header">
            <h3>Credit Distribution</h3>
            {/* <button className="credit-deduction-chart-action">View Details</button> */}
          </div>
          <div className="credit-deduction-chart-content">
            <AnimatedPieChart data={creditData} />
            <div className="credit-deduction-chart-legend">
              {creditData?.models?.map(model => (
                <div key={model.model} className="credit-deduction-legend-item">
                  <div 
                    className="credit-deduction-legend-badge"
                    style={{ background: getModelColor(model.model) }}
                  >
                    {getModelIcon(model.model)}
                  </div>
                  <div className="credit-deduction-legend-info">
                    <span className="credit-deduction-legend-label">{getModelLabel(model.model)}</span>
                    <span className="credit-deduction-legend-value">{model.credits_deducted} credits</span>
                  </div>
                  <span className="credit-deduction-legend-percentage">{model.percentage}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="credit-deduction-models-breakdown">
          <div className="credit-deduction-section-header">
            <h3>Models Breakdown</h3>
            {/* <div className="credit-deduction-view-toggle">
              <button className="credit-deduction-toggle-btn active">Grid</button>
              <button className="credit-deduction-toggle-btn">List</button>
            </div> */}
          </div>
          <div className="credit-deduction-models-grid">
            {creditData?.models?.map(model => (
              <div key={model.model} className="credit-deduction-model-card credit-deduction-glass">
                <div className="credit-deduction-model-header">
                  <div 
                    className="credit-deduction-model-avatar"
                    style={{ background: getModelColor(model.model) }}
                  >
                    {getModelIcon(model.model)}
                  </div>
                  <div className="credit-deduction-model-info">
                    <h4>{getModelLabel(model.model)}</h4>
                    <p>{model.usage_count} uses</p>
                  </div>
                  <div className="credit-deduction-model-badge">
                    {model.percentage}
                  </div>
                </div>
                
                <div className="credit-deduction-model-stats">
                  <div className="credit-deduction-model-stat">
                    <span className="credit-deduction-model-stat-value">{model.credits_deducted}</span>
                    <span className="credit-deduction-model-stat-label">Credits</span>
                  </div>
                  <div className="credit-deduction-model-stat">
                    <span className="credit-deduction-model-stat-value">
                      {Math.round(model.credits_deducted / model.usage_count)}
                    </span>
                    <span className="credit-deduction-model-stat-label">Avg/Use</span>
                  </div>
                  <div className="credit-deduction-model-stat">
                    <span className="credit-deduction-model-stat-value">
                      {/* {model.credits_deducted > 10 ? 'High' : model.credits_deducted > 5 ? 'Med' : 'Low'} */}
                      {model.usage_count}
                    </span>
                    <span className="credit-deduction-model-stat-label">Uses</span>
                  </div>
                </div>

                <div className="credit-deduction-usage-progress">
                  <div className="credit-deduction-progress-bar">
                    <div 
                      className="credit-deduction-progress-fill"
                      style={{ 
                        width: model.percentage,
                        background: getModelColor(model.model)
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderDetailed = () => (
    <div className="credit-deduction-detailed-content">
      <div className="credit-deduction-detailed-header">
        <div className="credit-deduction-detailed-header-content">
          <h3>Detailed Usage Analytics</h3>
          <p>Comprehensive breakdown of credit usage across all models</p>
        </div>
        {/* <div className="credit-deduction-header-controls">
          <div className="credit-deduction-filter-group">
            <select className="credit-deduction-filter-select credit-deduction-glass">
              <option>All Time</option>
              <option>Last 30 Days</option>
              <option>Last 7 Days</option>
              <option>Today</option>
            </select>
            <select className="credit-deduction-filter-select credit-deduction-glass">
              <option>All Models</option>
              <option>Text Models</option>
              <option>Chat Models</option>
              <option>Video Models</option>
            </select>
          </div>
        </div> */}
      </div>

      <div className="credit-deduction-analytics-table credit-deduction-glass">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Credits Used</th>
              <th>Usage Count</th>
              <th>Percentage</th>
              <th>Avg/Use</th>
              <th>Efficiency</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {creditData?.models?.map(model => {
              const avgPerUse = Math.round(model.credits_deducted / model.usage_count);
              const efficiency = avgPerUse <= 5 ? 'High' : avgPerUse <= 10 ? 'Medium' : 'Low';
              
              return (
                <tr key={model.model}>
                  <td>
                    <div className="credit-deduction-model-cell">
                      <div 
                        className="credit-deduction-model-avatar-sm"
                        style={{ background: getModelColor(model.model) }}
                      >
                        {getModelIcon(model.model)}
                      </div>
                      <div className="credit-deduction-model-details">
                        <span className="credit-deduction-model-name">{getModelLabel(model.model)}</span>
                        <span className="credit-deduction-model-type">AI Model</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="credit-deduction-metric-value">{model.credits_deducted}</div>
                  </td>
                  <td>
                    <div className="credit-deduction-metric-value">{model.usage_count}</div>
                  </td>
                  <td>
                    <div className="credit-deduction-percentage-display">
                      <div className="credit-deduction-percentage-bar">
                        <div 
                          className="credit-deduction-percentage-fill"
                          style={{ 
                            width: model.percentage,
                            background: getModelColor(model.model)
                          }}
                        ></div>
                      </div>
                      <span>{model.percentage}</span>
                    </div>
                  </td>
                  <td>
                    <div className="credit-deduction-metric-value">{avgPerUse}</div>
                  </td>
                  <td>
                    <div className={`credit-deduction-efficiency-badge ${efficiency.toLowerCase()}`}>
                      {efficiency}
                    </div>
                  </td>
                  <td>
                    <div className="credit-deduction-trend-indicator up">↗</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="credit-deduction-insights-section">
        <h4>Usage Insights & Recommendations</h4>
        <div className="credit-deduction-insights-grid">
          <div className="credit-deduction-insight-card credit-deduction-glass">
            <div className="credit-deduction-insight-icon">🏆</div>
            <div className="credit-deduction-insight-content">
              <h5>Most Used Model</h5>
              <p>{creditData?.models?.[0] ? getModelLabel(creditData.models[0].model) : 'N/A'}</p>
              <span className="credit-deduction-insight-metric">{creditData?.models?.[0]?.percentage || '0%'}</span>
            </div>
          </div>
          
          <div className="credit-deduction-insight-card credit-deduction-glass">
            <div className="credit-deduction-insight-icon">💰</div>
            <div className="credit-deduction-insight-content">
              <h5>Cost Optimization</h5>
              <p>Consider using Imagen for lighter tasks</p>
              <span className="credit-deduction-insight-metric positive">Save 15%</span>
            </div>
          </div>
          
          <div className="credit-deduction-insight-card credit-deduction-glass">
            <div className="credit-deduction-insight-icon">⚡</div>
            <div className="credit-deduction-insight-content">
              <h5>Efficiency Tip</h5>
              <p>Batch process similar requests</p>
              <span className="credit-deduction-insight-metric positive">+20% efficiency</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCharts = () => (
    <div className="credit-deduction-charts-content">
      <div className="credit-deduction-charts-grid">
        <div className="credit-deduction-chart-card credit-deduction-glass large">
          <div className="credit-deduction-chart-header">
            <h4>Credit Usage Over Time</h4>
            <div className="credit-deduction-chart-legend">
              {creditData?.models?.slice(0, 2).map(model => (
                <div key={model.model} className="credit-deduction-legend-item">
                  <div 
                    className="credit-deduction-legend-dot" 
                    style={{background: getModelColor(model.model)}}
                  ></div>
                  <span>{getModelLabel(model.model)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="credit-deduction-line-chart">
            <div className="credit-deduction-chart-placeholder">
              <p>Interactive Line Chart</p>
            </div>
          </div>
        </div>
        
        <div className="credit-deduction-chart-card credit-deduction-glass">
          <h4>Usage Frequency</h4>
          <div className="credit-deduction-bar-chart-vertical">
            {creditData?.models?.map(model => (
              <div key={model.model} className="credit-deduction-bar-item">
                <div className="credit-deduction-bar-label">{getModelLabel(model.model)}</div>
                <div className="credit-deduction-bar-track">
                  <div 
                    className="credit-deduction-bar-fill"
                    style={{ 
                      height: `${(model.usage_count / 10) * 100}%`,
                      background: getModelColor(model.model)
                    }}
                  ></div>
                </div>
                <div className="credit-deduction-bar-value">{model.usage_count}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <div className="credit-deduction-comparison-section">
        <div className="credit-deduction-chart-card credit-deduction-glass">
          <h4>Cost vs Efficiency</h4>
          <div className="credit-deduction-scatter-plot">
            <div className="credit-deduction-chart-placeholder">
              <p>Scatter Plot Visualization</p>
            </div>
          </div>
        </div>
        
        <div className="credit-deduction-metrics-grid">
          <div className="credit-deduction-metric-card credit-deduction-glass">
            <div className="credit-deduction-metric-icon">🎯</div>
            <div className="credit-deduction-metric-content">
              <h5>Accuracy Score</h5>
              <div className="credit-deduction-metric-value">92%</div>
              <div className="credit-deduction-metric-progress">
                <div className="credit-deduction-progress-fill" style={{width: '92%'}}></div>
              </div>
            </div>
          </div>
          
          <div className="credit-deduction-metric-card credit-deduction-glass">
            <div className="credit-deduction-metric-icon">🚀</div>
            <div className="credit-deduction-metric-content">
              <h5>Performance</h5>
              <div className="credit-deduction-metric-value">87%</div>
              <div className="credit-deduction-metric-progress">
                <div className="credit-deduction-progress-fill" style={{width: '87%'}}></div>
              </div>
            </div>
          </div>
          
          <div className="credit-deduction-metric-card credit-deduction-glass">
            <div className="credit-deduction-metric-icon">💡</div>
            <div className="credit-deduction-metric-content">
              <h5>Optimization</h5>
              <div className="credit-deduction-metric-value">78%</div>
              <div className="credit-deduction-metric-progress">
                <div className="credit-deduction-progress-fill" style={{width: '78%'}}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className={`credit-deduction-modal-backdrop ${isClosing ? 'closing' : ''}`} onClick={handleClose}></div>
      
      <div className={`credit-deduction-modal-container ${isClosing ? 'closing' : ''}`}>
        <div className="credit-deduction-modal credit-deduction-glass">
          <div className="credit-deduction-modal-header">
            <div className="credit-deduction-header-content">
              <div className="credit-deduction-title-section">
                <h2>Credit Usage Analytics</h2>
                <p>Detailed breakdown of AI model usage and credit consumption</p>
              </div>
              <div className="credit-deduction-user-info credit-deduction-glass">
                <div className="credit-deduction-user-avatar">
                  {user?.user_name?.charAt(0)?.toUpperCase()}
                </div>
                <div className="credit-deduction-user-details">
                  <h4>{user?.user_name}</h4>
                  <p>ID: {user?.user_id}</p>
                </div>
                <div className="credit-deduction-user-stats">
                  <div className="credit-deduction-user-stat">
                    <span className="credit-deduction-stat-value">{creditData?.total_credits_all_models || 0}</span>
                    <span className="credit-deduction-stat-label">Credits Used</span>
                  </div>
                </div>
              </div>
            </div>
            <button className="credit-deduction-close-button" onClick={handleClose}>
              <svg viewBox="0 0 24 24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>

          <div className="credit-deduction-modal-tabs">
            <button 
              className={`credit-deduction-tab ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
              </svg>
              Overview
            </button>
            <button 
              className={`credit-deduction-tab ${activeTab === 'detailed' ? 'active' : ''}`}
              onClick={() => setActiveTab('detailed')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
              </svg>
              Detailed View
            </button>
            {/* <button 
              className={`credit-deduction-tab ${activeTab === 'charts' ? 'active' : ''}`}
              onClick={() => setActiveTab('charts')}
            >
              <svg viewBox="0 0 24 24">
                <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" />
              </svg>
              Analytics
            </button> */}
          </div>

          <div className="credit-deduction-modal-body">
            {loading ? (
              <div className="credit-deduction-loading-state">
                <div className="credit-deduction-loading-spinner"></div>
                <p>Loading credit analytics...</p>
              </div>
            ) : (
              <>
                {activeTab === 'overview' && renderOverview()}
                {activeTab === 'detailed' && renderDetailed()}
                {activeTab === 'charts' && renderCharts()}
              </>
            )}
          </div>

          <div className="credit-deduction-modal-footer">
            <div className="credit-deduction-footer-content">
              <div className="credit-deduction-footer-info">
                <span>Last updated: {new Date().toLocaleDateString()}</span>
                <span>Data refresh: Auto</span>
              </div>
              <div className="credit-deduction-footer-actions">
                <button className="credit-deduction-btn-secondary credit-deduction-glass">
                  <svg viewBox="0 0 24 24">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                  </svg>
                  Export Report
                </button>
                <button className="credit-deduction-btn-primary" onClick={handleClose}>
                  Close Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CreditDeductionModal;