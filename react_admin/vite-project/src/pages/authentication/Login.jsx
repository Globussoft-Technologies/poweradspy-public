import React, { useState } from "react";
import { CiMail } from "react-icons/ci";
import { FiEye } from "react-icons/fi";
import { FiEyeOff } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
// import '../../App.css';
import axios from "axios";
import Cookies from 'js-cookie';
import PasLogoFull from '../../assets/PasLogoFull.png'
import { useEffect } from "react";

const Login = () => {
  const [showPassowrd, setShowPassword] = useState(false);
  const [username, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [error,setIsError] =useState(false);

  const navigate = useNavigate()

  const from = localStorage.getItem('lastPath') || "/pas/system-info"

  useEffect(() => {
    const token = Cookies.get("token");
    if (token) {
      navigate(from, { replace: true });
    }
  }, []);
  const handleLogin = async (e)=>{
    e.preventDefault();   
    const loginData = {
        username: username,
        password: password,
    };

    try {
      const nodeApi = import.meta.env.VITE_NODE_USER_ACTIVITY_API;
      const response = await axios.post(`${nodeApi}login`,
        { username, password },
        { headers: { 'Content-Type': 'application/json' } }
      );

      if(response.data.code == 200){
          const token = response.data?.data?.token;
          Cookies.set('token', token);
          Cookies.set('nodeToken', token);
          setIsError(false);
          navigate('/pas/system-info');
      }else{
          setIsError(true);
      }

    } catch (error) {
        console.error('Error during login', error);
        setIsError(true);
    }
  }
  const userNameHandler = (e)=>{
     setUserName(e.target.value);
  }

  const passwordNameHandler = (e)=>{
    setPassword(e.target.value);
  }
  return (
    <div className="am-layout am-common" style={{ height: "100%" }}>
      <a name="top"></a>
      <div className="am-header">
        <div className="am-header-content-wrapper am-main">
          <div className="am-header-content">
            <div className="am-header-logo-wrapper">
              <a href="https://app.adsgpt.io/amember/member">
                <img
                  className="am-header-content-logo"
                  src="/amember/data/public/67617c2ac83e8.png"
                  alt="AdsGPT"
                />
              
              </a>
          
            </div>
            <div className="am-header-content-content"></div>
          </div>
        </div>
      </div>
      <div className="am-header-line"></div>
      <div className="am-body">
        <div className="am-body-content-wrapper am-main">
          <div className="am-body-content">
            <div className="am-body-content-top"></div>
            <div className="am-body-content-content">
              <div className="am-login-form-wrapper">
                <div className="am-form am-auth-form am-login-form">
                  <div className="flex gap-[24px] justify-center">
                  <a
                    href="https://app.adsgpt.io/amember/member"
               
                  >
                    <img
                      className="w-[180px] h-[55px]"
                      src="https://app.adsgpt.io/amember/data/public/673ac6707b2be.png"
                      alt="AdsGPT"
                      
                    />
                  </a>
                  <a href="">
                <img src={PasLogoFull} alt=""  className="w-[192px] h-[62px]"/>
              </a></div>
                  <form
                    name="login"
                    method="post"
                    action="http://localhost:7000/adsgpt/admin-panel/login"
                    className="am-login-form-form"
                    // data-options='{"show_recaptcha":false,"recaptcha_key":null,"recaptcha_theme":"light","recaptcha_size":"normal","recaptcha_hl":"en"}'
                  >
                    <div>
                      <div
                        className="am-row am-row-wide am-row-login-recaptcha am-row-recaptcha"
                        id="login-recaptcha-row"
                        style={{ display: "none" }}
                      >
                        <div className="am-element am-element-recaptcha">
                          <div className="am-recaptcha-element"></div>
                        </div>
                      </div>
                      <div className="am-row am-row-login-login">
                        <div className="am-element-title">
                          <label
                            className="am-element-title !text-[16px]"
                            htmlFor="amember-login"
                          >
                            Username/Email
                          </label>
                        </div>
                        <div className="am-element relative">
                          <input
                            type="text"
                            id="amember-login"
                            name="amember_login"
                            size="15"
                            placeholder="Username/Email"
                            autoComplete="username"
                            data-temp-mail-org="0"
                            style={{
                              width: "100%",
                              display: "flex",
                              justifyContent: "center",
                              alignItems: "center",
                            }}
                            onChange={userNameHandler}
                          />
                          <CiMail className="absolute right-[12px] top-[10px] w-[20px] h-[20px]" />
                        </div>
                      </div>
                      <div className="am-row am-row-login-pass">
                        <div className="am-element-title">
                          <label
                            className="am-element-title !text-[16px]"
                            htmlFor="amember-pass"
                          >
                            Password
                          </label>
                        </div>
                        <div className="am-element relative">
                          <input
                            type={showPassowrd ? "text" : "password"}
                            id="amember-pass"
                            name="amember_pass"
                            className="am-pass-reveal text:placeholder-[14px]"
                            size="15"
                            placeholder="Enter Password"
                            autoComplete="current-password"
                            spellCheck="false"
                            onChange={passwordNameHandler}
                          />
                          {/* showPassowrd,setShowPassword */}
                          {showPassowrd ? (
                            <FiEye
                              className="absolute right-[12px] top-[10px] w-[20px] h-[20px]"
                              onClick={() => setShowPassword(!showPassowrd)}
                            />
                          ) : (
                            <FiEyeOff
                              className="absolute right-[12px] top-[10px] w-[20px] h-[20px]"
                              onClick={() => setShowPassword(!showPassowrd)}
                            />
                          )}
                      <div>
                      {error&&
                          <label className="text-[#ff0000] py-[12px] mb-[12px]">Username or password incorrect</label>
                      }      
                      </div>
                          <span
                            className="am-switch-reveal am-switch-reveal-off"
                            title="Toggle Password Visibility"
                          ></span>
                          <label
                            className="am-element-title !mt-[12px]"
                            htmlFor="remember_login"
                            id="am-form-login-remember"
                          >
                            <input
                              type="checkbox"
                              name="remember_login"
                              id="remember_login"
                              value="1"
                            />{" "}
                            Stay signed in
                          </label>
                        </div>
                      </div>
                      <div className="am-row am-row-buttons">
                        <div className="element">
                          <input type="submit" value="Login" onClick={handleLogin}/>
                          <span className="am-form-login-switch-wrapper">
                            <a
                              href=""
                              className="local-link am-form-login-switch"
                            >
                              Forgot password?
                            </a>
                          </span>
                        </div>
                      </div>
                    </div>
                    <input
                      type="hidden"
                      name="login_attempt_id"
                      value="1739856393"
                    />
                    <input
                      type="hidden"
                      name="amember_redirect_url"
                      value="/amember/member"
                    />
                  </form>
                </div>
              </div>
              <div className="am-signup-link">
                Not registered yet? <a href="/amember/signup">Signup here</a>
              </div>
            </div>
          </div>
          <div id="am-flash" className="am-flash">
            <div className="am-flash-mask"></div>
            <div className="am-flash-content"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
