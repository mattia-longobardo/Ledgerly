const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id the database can be asked about: anything else is a page that does not exist. */
export const isFundId = (id: string): boolean => UUID.test(id);
