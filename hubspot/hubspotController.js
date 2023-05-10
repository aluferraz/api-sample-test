const HUBSPOT_CONFIG = require('./config/hubspot_config');
const hubspot = require('@hubspot/api-client');
const hubspotClient = new hubspot.Client({ accessToken: '' });

class HubSpotController {
    hubspotClient = null;
    expirationDate = null;
    domain = null;
    hubId = null;
    q = null;
    account = null;
    operation = '';

    ERRORS = {
        BOOTSTRAP_CLIENT_ERROR: 'Could not start hubspot client',
        REFRESH_TOKEN_ERROR: 'Could not refresh hubspot auth token',
        MAX_RETRIES_ERROR: `Failed to fetch contacts for the ${HUBSPOT_CONFIG.RETRY_LIMIT}th time. Aborting.`,
    }

    SUPPORTED_ENTITIES = [
        'contacts',
        'companies',
        'meetings'
    ]


    constructor(domain, hubId, q) {
        try {

            this.hubspotClient = hubspotClient;
            this.expirationDate = null;
            this.domain = domain;
            this.q = q;
            this.hubId = hubId;
            this.account = domain.integrations.hubspot.accounts.find(account => account.hubId === hubId);
        } catch (ex) {
            console.error(`${this.ERRORS.BOOTSTRAP_CLIENT_ERROR}: ${ex.message}`);
        }
    }

    getAccount() {
        return this.account;
    }

    updateLastPulledDates(entity, date) {
        if (entity in this.SUPPORTED_ENTITIES) {
            const account = this.getAccount();
            account.lastPulledDates[entity] = date;
        }
    }

    enqueue(obj) {
        return this.q.push(obj);
    }

    async callSearchAPI(entity, parameters) {
        if (this.expirationDate == null || new Date() > this.expirationDate) {
            this.expirationDate = await this.refreshAccessToken(this.domain, this.hubId);
        }

        if (this.expirationDate == null) {
            throw new Error(this.ERRORS.REFRESH_TOKEN_ERROR);
        }
        return await this.exponetialBackoff(0, entity, parameters);

    }

    async exponetialBackoff(attempCount, entity, parameters) {
        if (attempCount == HUBSPOT_CONFIG.RETRY_LIMIT) {
            throw new Error(this.ERRORS.MAX_RETRIES_ERROR);
        }
        let self = this;
        try {
            let searchResult = {};
            switch (entity) {
                case 'contacts':
                    searchResult = await hubspotClient.crm.contacts.searchApi.doSearch(parameters);
                    break;
                case 'companies':
                    searchResult = await hubspotClient.crm.companies.searchApi.doSearch(parameters);
                    break;

                case 'meetings':
                    //https://developers.hubspot.com/docs/api/crm/meetings
                    searchResult = await hubspotClient.crm.objects.meetings.searchApi.doSearch(parameters);
                    break;
                default:
                    throw new Error('Invalid entity');
            }

            return searchResult;
        } catch (ex) {
            const backoffTime = HUBSPOT_CONFIG.EXPONETIAL_BACKOFF_BASE * Math.pow(2, attempCount);
            return await new Promise((resolve, reject) =>
                setTimeout(async () => {
                    try {
                        let retryResult = await self.exponetialBackoff(attempCount + 1, entity);
                        resolve(retryResult);
                    } catch (ex) {
                        reject(ex);
                    }

                }, backoffTime));
        }
    }

    setOperation(operation) {
        this.operation = operation;
    }
    getOperation() {
        return this.operation;
    }

    generateLastModifiedDateFilter(date, nowDate, propertyName = 'hs_lastmodifieddate') {
        const lastModifiedDateFilter = date ?
            {
                filters: [
                    { propertyName, operator: 'GTE', value: `${date.valueOf()}` },
                    { propertyName, operator: 'LTE', value: `${nowDate.valueOf()}` }
                ]
            } :
            {};

        return lastModifiedDateFilter;
    };


    refreshAccessToken(domain, hubId, tryCount) {
        this.setOperation('refreshAccessToken');
        const { HUBSPOT_CID, HUBSPOT_CS } = process.env;
        const account = domain.integrations.hubspot.accounts.find(account => account.hubId === hubId);
        const { accessToken, refreshToken } = account;
        let expirationDate = null;
        let self = this;
        return hubspotClient.oauth.tokensApi
            .createToken('refresh_token', undefined, undefined, HUBSPOT_CID, HUBSPOT_CS, refreshToken)
            .then(async result => {
                const body = result.body ? result.body : result;

                const newAccessToken = body.accessToken;
                expirationDate = new Date(body.expiresIn * 1000 + new Date().getTime());

                hubspotClient.setAccessToken(newAccessToken);
                if (newAccessToken !== accessToken) {
                    account.accessToken = newAccessToken;
                    await domain.save();
                }
                self.setOperation('');
                return expirationDate;
            });

    };
    async saveDomain() {
        // disable this for testing purposes
        return;

        this.domain.markModified('integrations.hubspot.accounts');
        await this.domain.save();
    };



}

module.exports = {
    HubSpotController
}