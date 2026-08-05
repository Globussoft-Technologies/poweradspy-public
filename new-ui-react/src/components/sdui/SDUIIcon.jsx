import React from 'react';
import admobIcon from '../../assets/admob.svg';

/**
 * Renders an icon based on the SDUIIcon schema.
 * - type "svg"  → renders inline SVG
 * - type "url"  → renders <img>
 * - type "none" → renders nothing
 */
const SDUIIcon = ({ icon, size = 14, className = '' }) => {
    if (!icon || icon.type === 'none' || !icon.value) return null;

    if (icon.type === 'svg') {
        return (
            <span
                className={`inline-flex items-center justify-center ${className}`}
                style={{ width: size, height: size }}
                dangerouslySetInnerHTML={{ __html: icon.value }}
            />
        );
    }

    if (icon.type === 'url') {
        const iconUrl = /(?:^|\/)admob\.svg(?:[?#].*)?$/i.test(icon.value)
            ? admobIcon
            : icon.value;
        return (
            <img
                src={iconUrl}
                alt=""
                width={size}
                height={size}
                className={`inline-block ${className}`}
            />
        );
    }

    return null;
};

export default SDUIIcon;
