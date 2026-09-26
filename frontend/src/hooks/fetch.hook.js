import axios from "axios";
import { useEffect, useState } from "react";
import { getUsername } from '../helper/helper'

axios.defaults.baseURL = process.env.REACT_APP_SERVER_DOMAIN;


/** custom hook */
export default function useFetch(query){
    const [getData, setData] = useState({ isLoading : false, apiData: undefined, status: null, serverError: null })

    useEffect(() => {

        const fetchData = async () => {
            try {
                setData(prev => ({ ...prev, isLoading: true}));

                const { username } = !query ? await getUsername() : '';
                
                // Callers pass their path with a leading slash (`/user/kanika`), and
                // this template adds one of its own, which produced `/api//user/...`.
                // Express happened to route it anyway, but the malformed URL was
                // real: it reached the network, appeared in logs, and would miss
                // any exact-path proxy rule or cache key. Normalise it here so
                // every caller is fixed at once and no server tolerance is relied on.
                const path = String(query).replace(/^\/+/, '');
                const { data, status } = !query ? await axios.get(`/api/user/${username}`) : await axios.get(`/api/${path}`);

                if(status === 201){
                    setData(prev => ({ ...prev, isLoading: false}));
                    setData(prev => ({ ...prev, apiData : data, status: status }));
                }

                setData(prev => ({ ...prev, isLoading: false}));
            } catch (error) {
                setData(prev => ({ ...prev, isLoading: false, serverError: error }))
            }
        };
        fetchData()

    }, [query]);

    return [getData, setData];
}