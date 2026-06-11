import React, { useState, useEffect, useRef } from 'react';
import styled, { createGlobalStyle, keyframes } from 'styled-components';
import { FiWifi, FiWifiOff, FiRefreshCw, FiMousePointer, FiType, FiUser, FiLock, FiLogIn } from 'react-icons/fi';
import { FaKeyboard, FaPowerOff, FaRegKeyboard, FaEye, FaEyeSlash } from 'react-icons/fa';
import { RiRemoteControlLine } from 'react-icons/ri';
const PASSWORD = import.meta.env.VITE_PASSWORD;
const USERNAME = import.meta.env.VITE_USERNAME;
const WEB_SOCKET_URL = import.meta.env.VITE_WEB_SOCKET_URL;
import {
  GlobalStyle,
  Container,
  Card,
  Title,
  Input,
  PrimaryButton,
  DangerButton,
  SecondaryButton,
  ConnectedStatus,
  DisconnectedStatus,
  ConnectingStatus,
  ReconnectingStatus,
  StatsContainer,
  StatBadge,
  RemoteScreen,
  ErrorMessage,
  ControlPanel,
  ControlButton,
  HeroSection,
  HeroTitle,
  UserProfile,
  Avatar,
  UserName,
  LoginContainer,
  LoginCard,
  LoginTitle,
  InputGroup,
  InputLabel,
  LoginInput,
  InputIcon,
  PasswordToggle,
  LoginButton,
  LoginFooter,
  LoginError
} from './RemoteControlStyles';

const RemoteControlDashboard = ({ connectToRemoteSystem }) => {
  // Configuration
  const config = {
    wsUrl: WEB_SOCKET_URL,
    apiKey: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
    // authEndpoint: 'https://api.example.com/auth/login',
    reconnectBaseDelay: 1000,
    maxReconnectAttempts: 5,
    minScreenshotInterval: 100,
    maxScreenshotInterval: 500,
    pingInterval: 10000,
    mouseThrottle: 30,
    keyThrottle: 50,
    maxCanvasWidth: 1920,
    maxCanvasHeight: 1080,
    useBinaryProtocol: true,
    latencyOptimization: {
      dynamicQuality: true,
      minQuality: 30,  // Minimum JPEG quality (0-100)
      maxQuality: 80,  // Maximum JPEG quality
      baseLatency: 50  // Baseline latency to adjust from (ms)
    }
  };
  // Hardcoded credentials (in a real app, these would be in environment variables)
  const validCredentials = {

   
    username: USERNAME || 'admin',
    password: PASSWORD || 'password123'
  };

  // State management
  const [systemName, setSystemName] = useState(connectToRemoteSystem);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [error, setError] = useState('');
  const [latency, setLatency] = useState(0);
  const [screenResolution, setScreenResolution] = useState({ width: 800, height: 600 });
  const [screenshotInterval, setScreenshotInterval] = useState(config.minScreenshotInterval);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [dragStartPosition, setDragStartPosition] = useState({ x: 0, y: 0 });
  
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [user, setUser] = useState(null);
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
    showPassword: false
  });
  const [authToken, setAuthToken] = useState('demo-token-1234567890'); // Simplified token for demo
  const [dragPreview, setDragPreview] = useState(null)
  const wsRef = useRef(null);
  const canvasRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const screenshotTimerRef = useRef(null);
  const pingTimerRef = useRef(null);
  const lastMouseMoveRef = useRef(0);
  const lastKeyPressRef = useRef(0);
  const lastPingTimeRef = useRef(0);
  const keyboardInputRef = useRef(null);
  const mouseMoveQueueRef = useRef([]);
const lastMousePositionRef = useRef({ x: 0, y: 0 });
const batchIntervalRef = useRef(null);

  // Initialize canvas size
  useEffect(() => {
    updateCanvasSize();
  }, [screenResolution]);

  // Focus management for keyboard input
  useEffect(() => {
    if (keyboardFocus && keyboardInputRef.current) {
      keyboardInputRef.current.focus();
    }
  }, [keyboardFocus]);

  
  useEffect(() => {
  const pressedKeys = new Set();
  const modifierKeys = new Set(['Control', 'Shift', 'Alt', 'Meta']);

  const handleKeyDown = (e) => {
    if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (now - lastKeyPressRef.current < config.keyThrottle && !modifierKeys.has(e.key)) return;
    lastKeyPressRef.current = now;

    // Add key to pressed keys set
    pressedKeys.add(e.key);

    // Send key down event
    wsRef.current.send(JSON.stringify({
      type: 'command',
      systemName: systemName.trim(),
      action: 'key_down',
      key: e.key.toLowerCase(),
      code: e.code,
      modifiers: {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey
      },
      token: authToken
    }));

    // For non-modifier keys, also send key press event
    if (!modifierKeys.has(e.key)) {
      wsRef.current.send(JSON.stringify({
        type: 'command',
        systemName: systemName.trim(),
        action: 'key_press',
        key: e.key.toLowerCase(),
        code: e.code,
        charCode: e.charCode,
        modifiers: {
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey
        },
        token: authToken
      }));
    }
  };

  const handleKeyUp = (e) => {
    if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // Remove key from pressed keys set
    pressedKeys.delete(e.key);

    // Send key up event
    wsRef.current.send(JSON.stringify({
      type: 'command',
      systemName: systemName.trim(),
      action: 'key_up',
      key: e.key.toLowerCase(),
      code: e.code,
      modifiers: {
        ctrl: pressedKeys.has('Control') || e.ctrlKey,
        shift: pressedKeys.has('Shift') || e.shiftKey,
        alt: pressedKeys.has('Alt') || e.altKey,
        meta: pressedKeys.has('Meta') || e.metaKey
      },
      token: authToken
    }));
  };

  if (connectionStatus === 'connected' && isAuthenticated) {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
  }

  return () => {
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('keyup', handleKeyUp);
  };
}, [connectionStatus, systemName, isAuthenticated, authToken]);
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting');
      }
      clearTimers();
    };
  }, []);

  const clearTimers = () => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (screenshotTimerRef.current) clearInterval(screenshotTimerRef.current);
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
  };

  const updateCanvasSize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height } = screenResolution;
    const aspectRatio = width / height;
    let newWidth = Math.min(width, config.maxCanvasWidth);
    let newHeight = newWidth / aspectRatio;

    if (newHeight > config.maxCanvasHeight) {
      newHeight = config.maxCanvasHeight;
      newWidth = newHeight * aspectRatio;
    }

    canvas.width = newWidth;
    canvas.height = newHeight;
  };

  // Authentication handlers
  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');

    try {
      // Simple validation against hardcoded credentials
      if (loginForm.email === validCredentials.username && loginForm.password === validCredentials.password) {
        setIsAuthenticated(true);
        setUser({
          id: 'user123',
          name: 'Admin Logout',
          email: validCredentials.username,
          role: 'admin'
        });
        setAuthToken('demo-token-1234567890');
        localStorage.setItem('remoteControlAuth', JSON.stringify({
          user: {
            id: 'user123',
            name: 'Admin Logout',
            email: validCredentials.username,
            role: 'admin'
          },
          token: 'demo-token-1234567890'
        }));
      } else {
        throw new Error('Invalid username or password');
      }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError(err.message || 'Login failed. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUser(null);
    setAuthToken('');
    localStorage.removeItem('remoteControlAuth');
    disconnectFromSystem();
  };

  const togglePasswordVisibility = () => {
    setLoginForm(prev => ({
      ...prev,
      showPassword: !prev.showPassword
    }));
  };

  const handleLoginChange = (e) => {
    const { name, value } = e.target;
    setLoginForm(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Check for existing session on component mount
  useEffect(() => {
    const storedAuth = localStorage.getItem('remoteControlAuth');
    if (storedAuth) {
      try {
        const authData = JSON.parse(storedAuth);
        setIsAuthenticated(true);
        setUser(authData.user);
        setAuthToken(authData.token);
      } catch (err) {
        console.error('Failed to parse stored auth data', err);
      }
    }
  }, []);

  const connectToSystem = () => {
    const name = systemName.trim();
    if (!name) {
      setError('Please enter a system name');
      return;
    }

    if (!isAuthenticated) {
      setError('Please login to connect to a system');
      return;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'New connection initiated');
    }

    setReconnectAttempts(0);
    clearTimeout(reconnectTimerRef.current);
    setConnectionStatus('connecting');
    setError('');

    try {
      wsRef.current = new WebSocket(
        `${config.wsUrl}?apiKey=${encodeURIComponent(config.apiKey)}&systemName=${encodeURIComponent(name)}&token=${encodeURIComponent(authToken)}`
      );

      wsRef.current.onopen = () => {
        setConnectionStatus('connected');
        setReconnectAttempts(0);
        startPeriodicOperations();
      };

      const sendBinaryMouseMove = (x, y) => {
        const buffer = new ArrayBuffer(9);
        const view = new DataView(buffer);
        view.setUint8(0, 2); // Mouse move command
        view.setUint32(1, x, true);
        view.setUint32(5, y, true);
        wsRef.current.send(buffer);
      };

      const arrayBufferToBase64 = (buffer) => {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
      };

// Binary message parsing
const parseBinaryMessage = (buffer) => {
  const view = new DataView(buffer);
  const messageType = view.getUint8(0);
  
  switch (messageType) {
    case 1: // Screenshot
      return {
        type: 'screenshot',
        data: arrayBufferToBase64(buffer.slice(1))
      };
    // Add other message types as needed
    default:
      throw new Error('Unknown binary message type');
  }
};

      // Modify your WebSocket onmessage handler:
wsRef.current.onmessage = (event) => {
  try {
    let message;
    
    // Check if message is binary
    if (event.data instanceof ArrayBuffer) {
      message = parseBinaryMessage(event.data);
    } else {
      message = JSON.parse(event.data);
    }
     switch (message.type) {
            case 'screenshot':
              handleScreenshot(message.data);
              break;
            case 'screen_resolution':
              handleScreenResolution(message.data);
              break;
            case 'pong':
              handlePong(message.timestamp);
              break;
            case 'error':
              handleError(message.message);
              break;
            case 'auth_error':
              handleAuthError();
              break;
            default:
              console.warn(`Unknown message type: ${message.type}`);
          }
    // ... rest of your message handling ...
  } catch (err) {
    console.error('Message processing error:', err);
    setError('Invalid message received from server');
  }
};
      wsRef.current.onclose = (event) => {
        setConnectionStatus('disconnected');
        stopPeriodicOperations();

        if (event.code === 1008 && event.reason.includes('Duplicate registration')) {
          setError('System name already in use. Please choose a different name.');
          setSystemName('');
        } else if (event.code === 1008 && event.reason.includes('Unauthorized')) {
          setError('Session expired. Please login again.');
          handleLogout();
        } else if (event.code !== 1000 && event.code !== 1001) {
          setConnectionStatus('reconnecting');
          attemptReconnect();
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('Connection error occurred');
      };
    } catch (err) {
      console.error('WebSocket initialization error:', err);
      setError(`Failed to initiate connection: ${err.message}`);
      setConnectionStatus('disconnected');
    }
  };

  const handleAuthError = () => {
    setError('Authentication failed. Please login again.');
    handleLogout();
  };

  const disconnectFromSystem = () => {
    if (wsRef.current) {
      wsRef.current.close(1000, 'User requested disconnect');
    }
    stopPeriodicOperations();
    setConnectionStatus('disconnected');
    setKeyboardFocus(false);
  };

  const reconnectToSystem = () => {
    clearTimeout(reconnectTimerRef.current);
    connectToSystem();
  };

  const attemptReconnect = () => {
    if (reconnectAttempts >= config.maxReconnectAttempts) {
      setError('Max reconnection attempts reached. Please try again.');
      setConnectionStatus('disconnected');
      return;
    }

    setReconnectAttempts(prev => prev + 1);
    const delay = Math.min(
      config.reconnectBaseDelay * Math.pow(2, reconnectAttempts) + (Math.random() * 100),
      30000
    );

    reconnectTimerRef.current = setTimeout(connectToSystem, delay);
  };

  // Periodic operations
  const startPeriodicOperations = () => {
    startScreenshotUpdates();
    startPingPong();
  };

  const stopPeriodicOperations = () => {
    stopScreenshotUpdates();
    stopPingPong();
  };

// Modify your screenshot request
const requestScreenshot = () => {
  if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

  // Dynamic quality based on latency
  const quality = Math.max(
    config.latencyOptimization.minQuality,
    config.latencyOptimization.maxQuality - (latency / 10)
  );

  wsRef.current.send(JSON.stringify({
    type: 'command',
    systemName: systemName.trim(),
    action: 'screenshot',
    quality: Math.round(quality),
    token: authToken
  }));
};

  // Update your screenshot interval handler
const startScreenshotUpdates = () => {
  stopScreenshotUpdates();
  
  // Dynamic interval based on latency
  const interval = Math.min(
    config.maxScreenshotInterval,
    Math.max(
      config.minScreenshotInterval,
      config.minScreenshotInterval * (latency / config.latencyOptimization.baseLatency)
    )
  );
  
  screenshotTimerRef.current = setInterval(requestScreenshot, interval);
};

  const stopScreenshotUpdates = () => {
    if (screenshotTimerRef.current) {
      clearInterval(screenshotTimerRef.current);
      screenshotTimerRef.current = null;
    }
  };

  const startPingPong = () => {
    stopPingPong();
    pingTimerRef.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        lastPingTimeRef.current = Date.now();
        wsRef.current.send(JSON.stringify({
          type: 'ping',
          timestamp: lastPingTimeRef.current,
          token: authToken
        }));
      }
    }, config.pingInterval);
  };

  const stopPingPong = () => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  };

  // Add this to your component
const [canvasOptimization, setCanvasOptimization] = useState({
  scale: 1,
  quality: 'high'
});

// Modify your canvas rendering
const handleScreenshot = (imageData) => {
  if (!imageData || typeof imageData !== 'string') return;

  const canvas = canvasRef.current;
  if (!canvas) return;

  // Use offscreen canvas for rendering
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = canvas.width;
  offscreenCanvas.height = canvas.height;
  const offscreenCtx = offscreenCanvas.getContext('2d');

  const img = new Image();
  img.onload = () => {
    requestAnimationFrame(() => {
      // Clear and draw to offscreen canvas first
      offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
      
      // Apply quality setting
      if (canvasOptimization.quality === 'low') {
        offscreenCtx.imageSmoothingEnabled = false;
      } else {
        offscreenCtx.imageSmoothingEnabled = true;
        offscreenCtx.imageSmoothingQuality = canvasOptimization.quality;
      }
      
      offscreenCtx.drawImage(img, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
      
      // Then copy to visible canvas in one operation
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(offscreenCanvas, 0, 0);

       // Draw drag preview if active
       if (dragPreview) {
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = 'rgba(0, 150, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(
          (dragPreview.startX / screenResolution.width) * canvas.width,
          (dragPreview.startY / screenResolution.height) * canvas.height
        );
        ctx.lineTo(
          (dragPreview.currentX / screenResolution.width) * canvas.width,
          (dragPreview.currentY / screenResolution.height) * canvas.height
        );
        ctx.stroke();
        
        // Draw start and end markers
        ctx.fillStyle = 'rgba(0, 150, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(
          (dragPreview.startX / screenResolution.width) * canvas.width,
          (dragPreview.startY / screenResolution.height) * canvas.height,
          5, 0, Math.PI * 2
        );
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(
          (dragPreview.currentX / screenResolution.width) * canvas.width,
          (dragPreview.currentY / screenResolution.height) * canvas.height,
          5, 0, Math.PI * 2
        );
        ctx.fill();
      }
    });
  };
  img.onerror = () => console.error('Error loading screenshot');
  img.src = 'data:image/jpeg;base64,' + imageData;
};


  const handleScreenResolution = (data) => {
    if (!data || !data.width || !data.height) {
      console.warn('Invalid screen resolution data');
      return;
    }

    setScreenResolution({ width: data.width, height: data.height });
    adjustScreenshotInterval();
  };

  const handlePong = (timestamp) => {
    const newLatency = Date.now() - timestamp;
    setLatency(newLatency);
    adjustScreenshotInterval();
  };

  const handleError = (message) => {
    setError(message);
  };

  // Adaptive screenshot interval based on latency
  const adjustScreenshotInterval = () => {
    const latencyFactor = Math.min(latency / 100, 2);
    const newInterval = Math.min(
      config.minScreenshotInterval * (1 + latencyFactor),
      config.maxScreenshotInterval
    );
    setScreenshotInterval(newInterval);

    if (connectionStatus === 'connected') {
      startScreenshotUpdates();
    }
  };

  // Mouse event handlers
  // const handleMouseMove = (e) => {
  //   if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

  //   const now = Date.now();
  //   if (now - lastMouseMoveRef.current < config.mouseThrottle) return;
  //   lastMouseMoveRef.current = now;

  //   const canvas = canvasRef.current;
  //   if (!canvas) return;

  //   const rect = canvas.getBoundingClientRect();
  //   const scaleX = screenResolution.width / rect.width;
  //   const scaleY = screenResolution.height / rect.height;

  //   const x = Math.round((e.clientX - rect.left) * scaleX);
  //   const y = Math.round((e.clientY - rect.top) * scaleY);

  //   // Clamp coordinates to remote screen bounds
  //   const clampedX = Math.max(0, Math.min(x, screenResolution.width));
  //   const clampedY = Math.max(0, Math.min(y, screenResolution.height));

  //   wsRef.current.send(JSON.stringify({
  //     type: 'command',
  //     systemName: systemName.trim(),
  //     action: 'mouse_move',
  //     x: clampedX,
  //     y: clampedY,
  //     token: authToken
  //   }));
  // };

  const handleMouseClick = (e) => {
    if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'command',
      systemName: systemName.trim(),
      action: 'mouse_click',
      token: authToken
    }));
  };

const handleContextMenu = (e) => {
  e.preventDefault(); // Prevent browser context menu
  
  if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

  const { x, y } = lastMousePositionRef.current;
  
  wsRef.current.send(JSON.stringify({
    type: 'command',
    systemName: systemName.trim(),
    action: 'mouse_right_click',
    x: x,
    y: y,
    token: authToken
  }));
};
  // Keyboard event handlers
  const handleKeyDown = (e) => {
    if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'command',
      systemName: systemName.trim(),
      action: 'key_combination',
      keys: e.keys.toLowerCase(),
      token: authToken
    }));
    if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !keyboardFocus) return;

    const now = Date.now();
    if (now - lastKeyPressRef.current < config.keyThrottle) return;
    lastKeyPressRef.current = now;

    // Special keys that we want to handle
    const specialKeys = [
      'Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 
      'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
      'Insert', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
    ];

    // Don't send modifier keys alone
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    // Send keydown event for special keys
    if (specialKeys.includes(e.key)) {
      wsRef.current.send(JSON.stringify({
        type: 'command',
        systemName: systemName.trim(),
        action: 'key_down',
        key: e.key.toLowerCase(),
        code: e.code,
        modifiers: {
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey
        },
        token: authToken
      }));
    }
  };

  const handleKeyUp = (e) => {

    if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !keyboardFocus) return;

    // Special keys that we want to handle
    const specialKeys = [
      'Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 
      'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
      'Insert', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
    ];

    // Don't send modifier keys alone
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    // Send keyup event for special keys
    if (specialKeys.includes(e.key)) {
      wsRef.current.send(JSON.stringify({
        type: 'command',
        systemName: systemName.trim(),
        action: 'key_up',
        key: e.key.toLowerCase(),
        code: e.code,
        modifiers: {
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey
        },
        token: authToken
      }));
    }
  };

  const handleKeyPress = (e) => {
    if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !keyboardFocus) return;

    const now = Date.now();
    if (now - lastKeyPressRef.current < config.keyThrottle) return;
    lastKeyPressRef.current = now;

    // Don't send modifier keys
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    // Send regular key presses (letters, numbers, symbols)
    wsRef.current.send(JSON.stringify({
      type: 'command',
      systemName: systemName.trim(),
      action: 'key_press',
      key: e.key.toLowerCase(),
      code: e.code,
      charCode: e.charCode,
      modifiers: {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey
      },
      token: authToken
    }));
  };

  const toggleKeyboardFocus = () => {
    setKeyboardFocus(!keyboardFocus);
  };

  const sendKeyCombination = (keys) => {
    if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'command',
      systemName: systemName.trim(),
      action: 'key_combination',
      keys: keys,
      token: authToken
    }));
  };

  // Render connection status indicator
  const renderStatusIndicator = () => {
    switch (connectionStatus) {
      case 'connected':
        return <ConnectedStatus><FiWifi /> Connected</ConnectedStatus>;
      case 'disconnected':
        return <DisconnectedStatus><FiWifiOff /> Disconnected</DisconnectedStatus>;
      case 'connecting':
        return <ConnectingStatus><FiWifi /> Connecting...</ConnectingStatus>;
      case 'reconnecting':
        return <ReconnectingStatus><FiRefreshCw /> Reconnecting ({reconnectAttempts}/{config.maxReconnectAttempts})</ReconnectingStatus>;
      default:
        return null;
    }
  };

  // Render user profile if authenticated
  const renderUserProfile = () => {
    if (!isAuthenticated || !user) return null;

    return (
      <UserProfile onClick={handleLogout}>
        <Avatar>
          {user.name.charAt(0)}
        </Avatar>
        <UserName>{user.name}</UserName>
      </UserProfile>
    );
  };

  // Render login form if not authenticated
  if (!isAuthenticated) {
    return (
      <>
        <GlobalStyle />
        <LoginContainer>
          <LoginCard>
            <LoginTitle>
              <RiRemoteControlLine size={28} />
              Remote Control Login
            </LoginTitle>
            
            <form onSubmit={handleLogin}>
              <InputGroup>
                <InputLabel>Username</InputLabel>
                <InputIcon>
                  <FiUser />
                </InputIcon>
                <LoginInput
                  type="text"
                  name="email"
                  value={loginForm.email}
                  onChange={handleLoginChange}
                  placeholder="Enter your username"
                  required
                />
              </InputGroup>
              
              <InputGroup>
                <InputLabel>Password</InputLabel>
                <InputIcon>
                  <FiLock />
                </InputIcon>
                <LoginInput
                  type={loginForm.showPassword ? "text" : "password"}
                  name="password"
                  value={loginForm.password}
                  onChange={handleLoginChange}
                  placeholder="Enter your password"
                  required
                />
                <PasswordToggle type="button" onClick={togglePasswordVisibility}>
                  {loginForm.showPassword ? <FaEyeSlash /> : <FaEye />}
                </PasswordToggle>
              </InputGroup>
              
              {loginError && <LoginError>{loginError}</LoginError>}
              
              <LoginButton type="submit" disabled={isLoggingIn}>
                {isLoggingIn ? 'Logging in...' : (
                  <>
                    <FiLogIn /> Login
                  </>
                )}
              </LoginButton>
            </form>
            
            <LoginFooter>
              Use admin credentials to login
            </LoginFooter>
          </LoginCard>
        </LoginContainer>
      </>
    );
  }

const handleMouseDown = (e) => {
  if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

  const canvas = canvasRef.current;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = screenResolution.width / rect.width;
  const scaleY = screenResolution.height / rect.height;

  const x = Math.round((e.clientX - rect.left) * scaleX);
  const y = Math.round((e.clientY - rect.top) * scaleY);

  // Clamp coordinates to remote screen bounds
  const clampedX = Math.max(0, Math.min(x, screenResolution.width));
  const clampedY = Math.max(0, Math.min(y, screenResolution.height));

  setIsMouseDown(true);
  setDragStartPosition({ x: clampedX, y: clampedY });

  // Send mouse down event
  wsRef.current.send(JSON.stringify({
    type: 'command',
    systemName: systemName.trim(),
    action: 'mouse_down',
    x: clampedX,
    y: clampedY,
    token: authToken
  }));
};

const handleMouseUp = (e) => {
  if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

  if (isMouseDown) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = screenResolution.width / rect.width;
    const scaleY = screenResolution.height / rect.height;

    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    // Clamp coordinates to remote screen bounds
    const clampedX = Math.max(0, Math.min(x, screenResolution.width));
    const clampedY = Math.max(0, Math.min(y, screenResolution.height));

    // Send mouse up event
    wsRef.current.send(JSON.stringify({
      type: 'command',
      systemName: systemName.trim(),
      action: 'mouse_up',
      x: clampedX,
      y: clampedY,
      token: authToken
    }));

    // If we moved significantly from the start position, it's a drag operation
    const distance = Math.sqrt(
      Math.pow(clampedX - dragStartPosition.x, 2) + 
      Math.pow(clampedY - dragStartPosition.y, 2)
    );

    if (distance > 5) { // Minimum drag distance threshold
      wsRef.current.send(JSON.stringify({
        type: 'command',
        systemName: systemName.trim(),
        action: 'mouse_drag',
        startX: dragStartPosition.x,
        startY: dragStartPosition.y,
        endX: clampedX,
        endY: clampedY,
        token: authToken
      }));
    }
  }

  setIsMouseDown(false);
};

// Update your existing handleMouseMove to handle drag movement
const handleMouseMove = (e) => {
  if (!isAuthenticated || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

  const now = Date.now();
  if (now - lastMouseMoveRef.current < config.mouseThrottle) return;
  lastMouseMoveRef.current = now;

  const canvas = canvasRef.current;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = screenResolution.width / rect.width;
  const scaleY = screenResolution.height / rect.height;

  const x = Math.round((e.clientX - rect.left) * scaleX);
  const y = Math.round((e.clientY - rect.top) * scaleY);

  // Clamp coordinates to remote screen bounds
  const clampedX = Math.max(0, Math.min(x, screenResolution.width));
  const clampedY = Math.max(0, Math.min(y, screenResolution.height));

  // Update last mouse position
  lastMousePositionRef.current = { x: clampedX, y: clampedY };

  if (isMouseDown) {
    // During drag, send both move and drag events
    wsRef.current.send(JSON.stringify({
      type: 'command',
      systemName: systemName.trim(),
      action: 'mouse_move',
      x: clampedX,
      y: clampedY,
      isDragging: true,
      token: authToken
    }));
    setDragPreview({
      startX: dragStartPosition.x,
      startY: dragStartPosition.y,
      currentX: clampedX,
      currentY: clampedY
    });
  } else {
    setDragPreview(null);
    // Normal mouse movement
    wsRef.current.send(JSON.stringify({
      type: 'command',
      systemName: systemName.trim(),
      action: 'mouse_move',
      x: clampedX,
      y: clampedY,
      isDragging: false,
      token: authToken
    }));
  }
};
  // Render the main dashboard if authenticated
  return (
    <>
      <GlobalStyle />
      <Container>
        <HeroSection>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <HeroTitle>
              <RiRemoteControlLine size={32} />
              Remote Control Dashboard
            </HeroTitle>
            {renderUserProfile()}
          </div>
        </HeroSection>

        <Card>
          <Title>
            <FiWifi />
            System Connection
          </Title>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', width: "50%" }}>
              <Input
                type="text"
                value={systemName}
                onChange={(e) => setSystemName(e.target.value)}
                placeholder="Enter system name (e.g., MySystem123)"
                disabled={connectionStatus === 'connected' || connectionStatus === 'connecting'}
              />
              
              {renderStatusIndicator()}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {connectionStatus === 'disconnected' && (
                <PrimaryButton onClick={connectToSystem} disabled={connectionStatus === 'connecting'}>
                  Connect
                </PrimaryButton>
              )}
              
              {connectionStatus === 'connected' && (
                <>
                  <DangerButton onClick={disconnectFromSystem}>
                    <FaPowerOff /> Disconnect
                  </DangerButton>
                  {/* <SecondaryButton onClick={toggleKeyboardFocus}>
                    <FaKeyboard /> {keyboardFocus ? 'Disable' : 'Enable'} Keyboard
                  </SecondaryButton> */}
                </>
              )}
            </div>
          </div>
          <StatsContainer>
            {connectionStatus === 'connected' && (
              <>
                <StatBadge>
                  <FiMousePointer />
                  Resolution: {screenResolution.width}x{screenResolution.height}
                </StatBadge>
                <StatBadge>
                  <FiType />
                  Latency: {latency}ms
                </StatBadge>
                {/* <StatBadge>
                  <FaKeyboard />
                  Keyboard: {keyboardFocus ? 'Enabled' : 'Disabled'}
                </StatBadge> */}
              </>
            )}
          </StatsContainer>

          {error && <ErrorMessage>{error}</ErrorMessage>}
        </Card>

        {connectionStatus === 'connected' && (
          <>
            <Card>
              <Title>
                <FiMousePointer />
                Remote Screen
              </Title>
              <RemoteScreen
                ref={canvasRef}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp} // Handle case when mouse leaves canvas during drag
                onClick={handleMouseClick}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                onContextMenu={handleContextMenu}
                style={{ cursor: isMouseDown ? 'grabbing' : 'pointer' }}
              />
            </Card>
          </>
        )}
      </Container>
    </>
  );
};

export default RemoteControlDashboard;