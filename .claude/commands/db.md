Run a SQL query against the EGM database.

Execute this command:
```
docker exec egm-postgres psql -U postgres -d egm_local -c "SET search_path TO egm; $ARGUMENTS"
```

If $ARGUMENTS is empty, show available tables:
```
docker exec egm-postgres psql -U postgres -d egm_local -c "\dt egm.*"
```
