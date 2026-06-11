import axios from "axios"
import Cookies from 'js-cookie';

export const getApiCallWithParams = async (Api, params = {}) => {
    const nodeToken = Cookies.get('nodeToken');
    try {
        const response = await axios.get(Api, {
            headers: { 'Authorization': `Bearer ${nodeToken}` },
            params,
            withCredentials: true,
        });
        return response?.data;
    } catch (error) {
        return {
            success: false,
            message: error.response ? error.response.data : error.message,
        };
    }
}

export const postApiCallWithBody = async (Api, body = {}) => {
    const nodeToken = Cookies.get('nodeToken');
    try {
        const response = await axios.post(Api, body, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${nodeToken}`,
            },
        });
        return response?.data;
    } catch (error) {
        return {
            success: false,
            message: error.response ? error.response.data : error.message,
        };
    }
}

export const postApiCall = async (Api, payload) => {
    const token = Cookies.get('token');
    try {
        let response = await axios.post(Api, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
        })

        return response?.data;

    } catch (error) {
        return {
            success: false,
            message: error.response ? error.response.data : error.message,
          };
    }
}


export const getApiCall = async (page)=>{
    const api = import.meta.env.VITE_SEARCHES_API;
    const token = Cookies.get('token');
    try {
        let response = await axios.get(`${api}get-all-users?page=${page}`,{
            headers: {
                'Authorization': `Bearer ${token}`
            },
        })
        return response?.data;
    } catch (error) {
        return {
            success: false,
            message: error.response ? error.response.data : error.message,
          };
    }
}

export const storeApiCall =async (data) =>{
    const api = import.meta.env.VITE_SEARCHES_API;
    const apiLinkedIn = import.meta.env.VITE_LINKEDIN_API;
    const token = Cookies.get('token');
    const emailF = localStorage.getItem('emailF');
    let url = `${api}get-planId?email=${emailF}`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    const {email,user_name,planId,user_id}= response?.data?.data[0];
        const mergedData = {
        ...data,
        email,
        user_name,
        planId: planId ?? 0,
        user_id,
        };
        
    try {
        let response = await axios.post(`${apiLinkedIn}daily-keyword-request`,mergedData,{
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
        })
        return response?.data;   
    } catch (error) {
        return {
            success: false,
            message: error.response ? error.response.data : error.message,
          };
    }
}