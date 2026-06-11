import React, { useEffect } from 'react';
import Cookies from 'js-cookie';
import { useNavigate } from 'react-router-dom';

export default function LogOut() {
    const navigate = useNavigate();

    useEffect(() => {
        Cookies.remove('token', { path: '/' });
        localStorage.removeItem('userId');
        localStorage.clear();
        navigate('/');
    }, [navigate]);
    
    return null;
}
