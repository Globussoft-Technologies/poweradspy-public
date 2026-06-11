import React from 'react'
import { Navigate} from 'react-router-dom';
import Cookies from 'js-cookie';

export default function AuthCheck({children}) {
    let isLoggedIn = Cookies.get("token");

    return isLoggedIn?children:<Navigate to="/" />
}
