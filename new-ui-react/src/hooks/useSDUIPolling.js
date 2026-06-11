import { useEffect, useRef } from 'react';
import { fetchSDUIConfigVersion, fetchSDUIConfig } from '../services/sduiService';
import { POLL_INTERVAL } from '../constants/sduiVersions';

/**
 * Lightweight polling hook.
 * Every POLL_INTERVAL ms, checks /config/version (tiny response).
 * Only fetches the full config when config_version has actually changed.
 *
 * Uses refs for callback and version to avoid re-creating the interval
 * on every render (which would cause cascading re-renders).
 */
export function useSDUIPolling(currentConfigVersion, onConfigChanged) {
    const versionRef = useRef(currentConfigVersion);
    const callbackRef = useRef(onConfigChanged);

    // Keep refs up to date without re-creating the effect
    useEffect(() => { versionRef.current = currentConfigVersion; }, [currentConfigVersion]);
    useEffect(() => { callbackRef.current = onConfigChanged; }, [onConfigChanged]);

    useEffect(() => {
        const poll = async () => {
            try {
                const versionInfo = await fetchSDUIConfigVersion();

                if (versionInfo && typeof versionInfo.config_version === 'number') {
                    if (versionInfo.config_version !== versionRef.current) {
                        const freshConfig = await fetchSDUIConfig({ skipCache: true });
                        if (freshConfig) callbackRef.current(freshConfig);
                    }
                    return;
                }

                // Fallback: version endpoint not available
                const freshConfig = await fetchSDUIConfig({ skipCache: true });
                if (freshConfig && freshConfig.config_version !== versionRef.current) {
                    callbackRef.current(freshConfig);
                }
            } catch {
                // Polling failure is non-fatal
            }
        };

        const interval = setInterval(poll, POLL_INTERVAL);
        return () => clearInterval(interval);
    }, []); // Runs once — uses refs for dynamic values
}
