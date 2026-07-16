import React from 'react'
import {createBrowserRouter, RouterProvider} from 'react-router-dom'

// auth middleware
import { AuthorizeUser, ProtectRoute } from './middleware/auth';

//Components
import Username from './components/Username';
import Register from './components/Register';
import Profile from './components/Profile';
import Password from './components/Password';
import PageNotFound from './components/PageNotFound';

//root routes
const router = createBrowserRouter([
  {
    path: '/',
    element: <Username/>
  },
  {
    path: '/register',
    element: <Register/>
  },
  {
    path: '/password',
    element: <ProtectRoute><Password/></ProtectRoute>
  },
  {
    path: '/profile',
    element: <AuthorizeUser><Profile/></AuthorizeUser>
  },
  {
    path: '*',
    element: <PageNotFound/>
  }
])

export default function App() {
  return (
    <main>
      <RouterProvider router = {router}></RouterProvider>
    </main>
  );
}

