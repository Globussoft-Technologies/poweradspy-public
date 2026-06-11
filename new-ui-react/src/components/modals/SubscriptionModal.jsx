import React from 'react';

const UPGRADE_URL = 'https://app.poweradspy.com/amember/signup/monthly-plans';
const LEARN_MORE_URL = 'https://app.poweradspy.com';

const FEATURES = [
    'Keyword Search',
    'Data Interval Search',
    'Bookmark',
    'Sort by Likes, Comments, Share, Newest, Running Longest',
    'Call to action',
    'Advertiser Search',
    'Domain Search',
    'Country Filter',
    'Ads Type Filter',
    'Placement Filter',
    'Funnel',
    'Gender Wise Filter',
    'Audience age',
    'Ad Insight',
    'E-commerce Platform',
    'Marketing Platform',
    'Filter by IOS,Android,Desktop,Mobile',
];

const NETWORKS = [
    { name: 'Facebook', color: '#1877f2' },
    { name: 'Instagram', color: '#e1306c' },
    { name: 'Google', color: '#4285f4' },
    { name: 'YouTube', color: '#ff0000' },
    { name: 'Reddit', color: '#ff4500' },
    { name: 'Quora', color: '#b92b27' },
    { name: 'Native', color: '#6c757d' },
    { name: 'GDN', color: '#fbbc04' },
    { name: 'Pinterest', color: '#e60023' },
    { name: 'LinkedIn', color: '#0077b5' },
];

const SubscriptionModal = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 999999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
            }}
        >
            <div
                style={{
                    width: '100%',
                    maxWidth: 660,
                    border: '1px solid #ffcc00',
                    borderRadius: 5,
                    background: 'rgba(27, 30, 61, 1)',
                    maxHeight: '90vh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                {/* Header */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '15px 20px',
                        borderBottom: 'none',
                    }}
                >
                    <h5
                        style={{
                            color: 'white',
                            fontWeight: 400,
                            fontSize: 16,
                            margin: 0,
                        }}
                    >
                        Discover more Ads with a Premium Subscription
                    </h5>
                    <button
                        onClick={onClose}
                        style={{
                            color: '#ccc',
                            background: 'transparent',
                            border: 0,
                            padding: '11px 15px',
                            fontSize: 22,
                            cursor: 'pointer',
                            lineHeight: 1,
                        }}
                        onMouseEnter={(e) => (e.target.style.color = '#fff')}
                        onMouseLeave={(e) => (e.target.style.color = '#ccc')}
                    >
                        &times;
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '10px 20px 20px', overflowY: 'auto' }}>
                    <p
                        style={{
                            color: 'white',
                            fontSize: 13,
                            lineHeight: 1.6,
                            fontWeight: 300,
                            paddingRight: 50,
                            marginBottom: 30,
                        }}
                    >
                        Upgrade today and join the ranks of successful brands using PowerAdSpy
                        to stay ahead of the curve. Unlock the full potential of PowerAdSpy and
                        take your brand to new heights.
                    </p>

                    {/* Plan heading */}
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 16,
                        }}
                    >
                        <div>
                            <h6
                                style={{
                                    fontSize: 9,
                                    padding: 0,
                                    margin: 0,
                                    color: '#ffcc00',
                                    textTransform: 'uppercase',
                                    letterSpacing: 1,
                                }}
                            >
                                MOST POPULAR
                            </h6>
                            <p style={{ color: 'white', margin: 0, fontSize: 14 }}>
                                PALLADIUM PLAN
                            </p>
                        </div>
                        <p
                            style={{
                                color: '#ffcc00',
                                margin: 0,
                                fontWeight: 300,
                                fontSize: 14,
                                letterSpacing: 0.5,
                            }}
                        >
                            $399/Month
                        </p>
                    </div>

                    {/* Feature chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {/* Networks chip */}
                        <div
                            style={{
                                backgroundColor: 'white',
                                display: 'flex',
                                padding: '5px 9px',
                                borderRadius: 5,
                                gap: 8,
                                alignItems: 'center',
                            }}
                        >
                            <p style={{ margin: 0, fontSize: 11, color: '#1c1e3e' }}>
                                Networks -
                            </p>
                            <div style={{ display: 'flex', gap: 3 }}>
                                {NETWORKS.map((net) => (
                                    <div
                                        key={net.name}
                                        title={net.name}
                                        style={{
                                            height: 12,
                                            width: 12,
                                            borderRadius: '50%',
                                            backgroundColor: net.color,
                                        }}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Feature chips */}
                        {FEATURES.map((feature) => (
                            <div
                                key={feature}
                                style={{
                                    backgroundColor: 'white',
                                    display: 'flex',
                                    padding: '5px 9px',
                                    borderRadius: 5,
                                    gap: 8,
                                    alignItems: 'center',
                                }}
                            >
                                <p style={{ margin: 0, fontSize: 11, color: '#1c1e3e' }}>
                                    {feature}
                                </p>
                                <div
                                    style={{
                                        height: 18,
                                        width: 18,
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: '0px 0px 8px 2px rgba(0, 0, 0, 0.15)',
                                        flexShrink: 0,
                                    }}
                                >
                                    <svg
                                        width="8"
                                        height="8"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="#1c1e3e"
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: 12,
                        padding: '15px 20px',
                        borderTop: 'none',
                    }}
                >
                    <a href={UPGRADE_URL} target="_blank" rel="noopener noreferrer">
                        <button
                            style={{
                                padding: '10px 30px',
                                background: 'linear-gradient(180deg, #f4cb02, #80e22ab8)',
                                fontSize: 13,
                                fontWeight: 500,
                                color: 'white',
                                border: '0px solid transparent',
                                borderRadius: 5,
                                boxShadow: 'inset 0px 2px 1px -1px #ffffff96',
                                cursor: 'pointer',
                            }}
                        >
                            Upgrade Now
                        </button>
                    </a>
                    <a href={LEARN_MORE_URL} target="_blank" rel="noopener noreferrer">
                        <button
                            style={{
                                padding: '10px 30px',
                                background: 'linear-gradient(181deg, #20d6c9, #2f678c)',
                                fontSize: 13,
                                fontWeight: 300,
                                color: 'white',
                                border: '0px solid transparent',
                                borderRadius: 5,
                                boxShadow: 'inset 0px 2px 1px -1px #ffffff96',
                                cursor: 'pointer',
                            }}
                        >
                            Learn More
                        </button>
                    </a>
                </div>
            </div>
        </div>
    );
};

export default SubscriptionModal;
