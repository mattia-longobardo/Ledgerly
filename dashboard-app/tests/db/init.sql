CREATE ROLE app_test LOGIN PASSWORD 'app_test' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT ALL ON DATABASE dashboard_test TO app_test;
\c dashboard_test
GRANT ALL ON SCHEMA public TO app_test;
