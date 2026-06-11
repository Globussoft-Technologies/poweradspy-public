import styled, { createGlobalStyle, keyframes } from 'styled-components';

// Animations
export const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

export const gradientBackground = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

export const slideIn = keyframes`
  from { transform: translateY(-20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

// Global styles
export const GlobalStyle = createGlobalStyle`
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  }

  body {
    background-color: #f8fafc;
    color: #1e293b;
    line-height: 1.6;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`;

// Common components
export const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
`;

export const Card = styled.div`
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  padding: 2rem;
  margin-bottom: 2rem;
  transition: all 0.3s ease;
  animation: ${fadeIn} 0.5s ease-out;

  &:hover {
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  }
`;

export const Title = styled.h2`
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

export const Input = styled.input`
  padding: 0.75rem 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  width: 100%;
  font-size: 1rem;
  transition: all 0.2s ease;
  margin-right: 1rem;

  &:focus {
    outline: none;
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
  }
`;

export const Button = styled.button`
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: none;
  margin-right: 0.5rem;

  &:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
`;

export const PrimaryButton = styled(Button)`
  background-color: #6366f1;
  color: white;

  &:hover:not(:disabled) {
    background-color: #4f46e5;
  }
`;

export const DangerButton = styled(Button)`
  background-color: #ef4444;
  color: white;

  &:hover:not(:disabled) {
    background-color: #dc2626;
  }
`;

export const SecondaryButton = styled(Button)`
  background-color: #e2e8f0;
  color: #1e293b;

  &:hover:not(:disabled) {
    background-color: #cbd5e1;
  }
`;

export const StatusIndicator = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  margin-left: 1rem;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.875rem;
`;

export const ConnectedStatus = styled(StatusIndicator)`
  background-color: #dcfce7;
  color: #16a34a;
`;

export const DisconnectedStatus = styled(StatusIndicator)`
  background-color: #fee2e2;
  color: #dc2626;
`;

export const ConnectingStatus = styled(StatusIndicator)`
  background-color: #fef9c3;
  color: #ca8a04;
  animation: pulse 2s infinite;
`;

export const ReconnectingStatus = styled(StatusIndicator)`
  background-color: #fef9c3;
  color: #ca8a04;
`;

export const StatsContainer = styled.div`
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
  margin-bottom: 1.5rem;
`;

export const StatBadge = styled.div`
  background-color: #f1f5f9;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
`;

export const RemoteScreen = styled.canvas`
  width: 100%;
  max-width: 100%;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background-color: #f1f5f9;
  image-rendering: optimizeQuality;
  margin-top: 1rem;
  transition: all 0.3s ease;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
  height: auto;
  user-select: none;
  touch-action: none;
  &:active {
    cursor: grabbing;
  }
  &:hover {
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }
`;

export const ErrorMessage = styled.p`
  color: #dc2626;
  margin-top: 1rem;
  font-size: 0.875rem;
`;

export const ControlPanel = styled.div`
  display: flex;
  gap: 1rem;
  margin-top: 1.5rem;
  flex-wrap: wrap;
`;

export const ControlButton = styled.button`
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background-color: white;
  border: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: #f8fafc;
    border-color: #cbd5e1;
  }

  &:active {
    background-color: #f1f5f9;
  }
`;

export const HeroSection = styled.div`
  background: linear-gradient(-45deg, #6366f1, #8b5cf6, #ec4899, #f43f5e);
  background-size: 400% 400%;
  animation: ${gradientBackground} 15s ease infinite;
  color: white;
  padding: 2rem;
  border-radius: 12px;
  margin-bottom: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

export const InputIcon = styled.span`
  position: absolute;
  left: 1rem;
  top: 2.7rem;
  color: #94a3b8;
`;
export const LoginError = styled(ErrorMessage)`
  text-align: center;
  margin-top: 1rem;
`;

export const LoginFooter = styled.div`
  margin-top: 1.5rem;
  text-align: center;
  font-size: 0.875rem;
  color: #64748b;
`;
export const LoginContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 80vh;
`;
export const LoginCard = styled.div`
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  padding: 2.5rem;
  width: 100%;
  max-width: 450px;
  animation: ${slideIn} 0.4s ease-out;
`;

export const LoginButton = styled(PrimaryButton)`
  width: 100%;
  justify-content: center;
  padding: 1rem;
  font-size: 1rem;
  margin-top: 0.5rem;
`;
export const InputLabel = styled.label`
  display: block;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: #475569;
`;
export const InputGroup = styled.div`
  margin-bottom: 1.5rem;
  position: relative;
`;
export const HeroTitle = styled.h1`
  font-size: 2rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 1rem;
`;

export const HeroText = styled.p`
  font-size: 1.1rem;
  opacity: 0.9;
  max-width: 800px;
`;

export const UserProfile = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-left: auto;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  background-color: #f1f5f9;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: #e2e8f0;
  }
`;

export const Avatar = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: #6366f1;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  text-transform: uppercase;
`;

export const UserName = styled.span`
  font-weight: 500;
  color: #6366f1;
`;

export const LoginInput = styled(Input)`
  padding-left: 2.5rem;
  margin-right: 0;
`;

// const GlobalStyle = createGlobalStyle`
//   * {
//     box-sizing: border-box;
//     margin: 0;
//     padding: 0;
//     font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
//   }

//   body {
//     background-color: #f8fafc;
//     color: #1e293b;
//     line-height: 1.6;
//   }

//   @keyframes pulse {
//     0%, 100% { opacity: 1; }
//     50% { opacity: 0.5; }
//   }
// `;

// // Animations
// const fadeIn = keyframes`
//   from { opacity: 0; transform: translateY(10px); }
//   to { opacity: 1; transform: translateY(0); }
// `;

// const gradientBackground = keyframes`
//   0% { background-position: 0% 50%; }
//   50% { background-position: 100% 50%; }
//   100% { background-position: 0% 50%; }
// `;

// const slideIn = keyframes`
//   from { transform: translateY(-20px); opacity: 0; }
//   to { transform: translateY(0); opacity: 1; }
// `;

// // Styled components
// const Container = styled.div`
//   max-width: 1200px;
//   margin: 0 auto;
//   padding: 2rem;
// `;

// const Card = styled.div`
//   background: white;
//   border-radius: 12px;
//   box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
//   padding: 2rem;
//   margin-bottom: 2rem;
//   transition: all 0.3s ease;
//   animation: ${fadeIn} 0.5s ease-out;

//   &:hover {
//     box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
//   }
// `;

// const Title = styled.h2`
//   font-size: 1.5rem;
//   font-weight: 600;
//   margin-bottom: 1.5rem;
//   color: #1e293b;
//   display: flex;
//   align-items: center;
//   gap: 0.5rem;
// `;

// const Input = styled.input`
//   padding: 0.75rem 1rem;
//   border: 1px solid #e2e8f0;
//   border-radius: 8px;
//   width: 100%;
//   font-size: 1rem;
//   transition: all 0.2s ease;
//   margin-right: 1rem;

//   &:focus {
//     outline: none;
//     border-color: #6366f1;
//     box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
//   }
// `;

// const Button = styled.button`
//   padding: 0.75rem 1.5rem;
//   border-radius: 8px;
//   font-size: 1rem;
//   font-weight: 500;
//   cursor: pointer;
//   transition: all 0.2s ease;
//   display: inline-flex;
//   align-items: center;
//   gap: 0.5rem;
//   border: none;
//   margin-right: 0.5rem;

//   &:disabled {
//     opacity: 0.7;
//     cursor: not-allowed;
//   }
// `;

// const PrimaryButton = styled(Button)`
//   background-color: #6366f1;
//   color: white;

//   &:hover:not(:disabled) {
//     background-color: #4f46e5;
//   }
// `;

// const DangerButton = styled(Button)`
//   background-color: #ef4444;
//   color: white;

//   &:hover:not(:disabled) {
//     background-color: #dc2626;
//   }
// `;

// const SecondaryButton = styled(Button)`
//   background-color: #e2e8f0;
//   color: #1e293b;

//   &:hover:not(:disabled) {
//     background-color: #cbd5e1;
//   }
// `;

// const StatusIndicator = styled.span`
//   display: inline-flex;
//   align-items: center;
//   gap: 0.5rem;
//   font-weight: 500;
//   margin-left: 1rem;
//   padding: 0.25rem 0.75rem;
//   border-radius: 9999px;
//   font-size: 0.875rem;
// `;

// const ConnectedStatus = styled(StatusIndicator)`
//   background-color: #dcfce7;
//   color: #16a34a;
// `;

// const DisconnectedStatus = styled(StatusIndicator)`
//   background-color: #fee2e2;
//   color: #dc2626;
// `;

// const ConnectingStatus = styled(StatusIndicator)`
//   background-color: #fef9c3;
//   color: #ca8a04;
//   animation: pulse 2s infinite;
// `;

// const ReconnectingStatus = styled(StatusIndicator)`
//   background-color: #fef9c3;
//   color: #ca8a04;
// `;

// const StatsContainer = styled.div`
//   display: flex;
//   gap: 1rem;
//   margin-top: 1rem;
//   margin-bottom: 1.5rem;
// `;

// const StatBadge = styled.div`
//   background-color: #f1f5f9;
//   padding: 0.5rem 1rem;
//   border-radius: 8px;
//   font-size: 0.875rem;
//   display: inline-flex;
//   align-items: center;
//   gap: 0.5rem;
// `;

// const RemoteScreen = styled.canvas`
//   width: 100%;
//   max-width: 100%;
//   border-radius: 8px;
//   border: 1px solid #e2e8f0;
//   background-color: #f1f5f9;
//   image-rendering: optimizeQuality;
//   margin-top: 1rem;
//   transition: all 0.3s ease;
//   box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);

//   &:hover {
//     box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
//   }
// `;

// const ErrorMessage = styled.p`
//   color: #dc2626;
//   margin-top: 1rem;
//   font-size: 0.875rem;
// `;

// const ControlPanel = styled.div`
//   display: flex;
//   gap: 1rem;
//   margin-top: 1.5rem;
//   flex-wrap: wrap;
// `;

// const ControlButton = styled.button`
//   padding: 0.75rem 1rem;
//   border-radius: 8px;
//   background-color: white;
//   border: 1px solid #e2e8f0;
//   display: flex;
//   align-items: center;
//   gap: 0.5rem;
//   font-size: 0.875rem;
//   cursor: pointer;
//   transition: all 0.2s ease;

//   &:hover {
//     background-color: #f8fafc;
//     border-color: #cbd5e1;
//   }

//   &:active {
//     background-color: #f1f5f9;
//   }
// `;

// const HeroSection = styled.div`
//   background: linear-gradient(-45deg, #6366f1, #8b5cf6, #ec4899, #f43f5e);
//   background-size: 400% 400%;
//   animation: ${gradientBackground} 15s ease infinite;
//   color: white;
//   padding: 2rem;
//   border-radius: 12px;
//   margin-bottom: 2rem;
//   display: flex;
//   flex-direction: column;
//   gap: 1rem;
// `;

// const HeroTitle = styled.h1`
//   font-size: 2rem;
//   font-weight: 700;
//   display: flex;
//   align-items: center;
//   gap: 1rem;
// `;

// const HeroText = styled.p`
//   font-size: 1.1rem;
//   opacity: 0.9;
//   max-width: 800px;
// `;

// // Login Form Components
// const LoginContainer = styled.div`
//   display: flex;
//   justify-content: center;
//   align-items: center;
//   min-height: 80vh;
// `;

// const LoginCard = styled.div`
//   background: white;
//   border-radius: 12px;
//   box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
//   padding: 2.5rem;
//   width: 100%;
//   max-width: 450px;
//   animation: ${slideIn} 0.4s ease-out;
// `;

export const LoginTitle = styled.h2`
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
  color: #1e293b;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
`;

// const InputGroup = styled.div`
//   margin-bottom: 1.5rem;
//   position: relative;
// `;

// const InputLabel = styled.label`
//   display: block;
//   margin-bottom: 0.5rem;
//   font-size: 0.875rem;
//   font-weight: 500;
//   color: #475569;
// `;

// const LoginInput = styled(Input)`
//   padding-left: 2.5rem;
//   margin-right: 0;
// `;

// const InputIcon = styled.span`
//   position: absolute;
//   left: 1rem;
//   top: 2.7rem;
//   color: #94a3b8;
// `;

export const PasswordToggle = styled.button`
  position: absolute;
  right: 1rem;
  top: 2.7rem;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
`;

// const LoginButton = styled(PrimaryButton)`
//   width: 100%;
//   justify-content: center;
//   padding: 1rem;
//   font-size: 1rem;
//   margin-top: 0.5rem;
// `;

// const LoginFooter = styled.div`
//   margin-top: 1.5rem;
//   text-align: center;
//   font-size: 0.875rem;
//   color: #64748b;
// `;

// const LoginError = styled(ErrorMessage)`
//   text-align: center;
//   margin-top: 1rem;
// `;

// // User Profile Components
// const UserProfile = styled.div`
//   display: flex;
//   align-items: center;
//   gap: 1rem;
//   margin-left: auto;
//   padding: 0.5rem 1rem;
//   border-radius: 8px;
//   background-color: #f1f5f9;
//   cursor: pointer;
//   transition: all 0.2s ease;

//   &:hover {
//     background-color: #e2e8f0;
//   }
// `;

// const Avatar = styled.div`
//   width: 36px;
//   height: 36px;
//   border-radius: 50%;
//   background-color: #6366f1;
//   color: white;
//   display: flex;
//   align-items: center;
//   justify-content: center;
//   font-weight: 600;
//   text-transform: uppercase;
// `;

// const UserName = styled.span`
//   font-weight: 500;
//   color: #6366f1;
// `;
