#!/bin/bash
if [ -f "server.js" ]; then
    mv server.js api/
    echo -e "\e[32mserver.js movido a api/ exitosamente.\e[0m"
else
    echo -e "\e[33mEl archivo server.js ya está en api/ o no existe en la raíz.\e[0m"
fi
cd api
npm install express @supabase/supabase-js dotenv cors pg
cd ..