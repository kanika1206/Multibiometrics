import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/store";

// to protect profile page from unauthorized users(users who donot have any account)
export const AuthorizeUser = ({ children }) => {
    const token = localStorage.getItem('token');

    if(!token){
        return <Navigate to={'/'} replace={true}></Navigate>
    }

    return children;
}

// to protect password page from unauthorized users
export const ProtectRoute = ({ children }) => {
    const username = useAuthStore.getState().auth.username;
    if(!username){
        return <Navigate to={'/'} replace={true}></Navigate>
    }
    return children;
}