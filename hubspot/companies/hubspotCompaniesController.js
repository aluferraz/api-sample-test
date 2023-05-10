
class HubSpotCompaniesController {
    hubspotController = null;
    entity = 'companies';
    constructor(hubspotController) {
        this.hubspotController = hubspotController;
    }
    async processCompanies() {
        this.hubspotController.setOperation('processCompanies');;

        const account = this.hubspotController.getAccount();
        const lastPulledDate = new Date(account.lastPulledDates.companies);
        const now = new Date();

        let hasMore = true;
        const offsetObject = {};
        const limit = 100;

        while (hasMore) {
            const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
            const lastModifiedDateFilter = this.hubspotController.generateLastModifiedDateFilter(lastModifiedDate, now);
            const searchObject = {
                filterGroups: [lastModifiedDateFilter],
                sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
                properties: [
                    'name',
                    'domain',
                    'country',
                    'industry',
                    'description',
                    'annualrevenue',
                    'numberofemployees',
                    'hs_lead_status'
                ],
                limit,
                after: offsetObject.after
            };

            let searchResult = {};
            try {
                searchResult = await this.hubspotController.callSearchAPI(this.entity, searchObject)
            } catch (ex) {
                //Controller already printed error.
                //Terminating function;
                return;
            }
            const data = searchResult?.results || [];
            offsetObject.after = parseInt(searchResult?.paging?.next?.after);

            console.log('fetch company batch');

            data.forEach(company => {
                if (!company.properties) return;

                const actionTemplate = {
                    includeInAnalytics: 0,
                    companyProperties: {
                        company_id: company.id,
                        company_domain: company.properties.domain,
                        company_industry: company.properties.industry
                    }
                };

                const isCreated = !lastPulledDate || (new Date(company.createdAt) > lastPulledDate);

                this.hubspotController.enqueue({
                    actionName: isCreated ? 'Company Created' : 'Company Updated',
                    actionDate: new Date(isCreated ? company.createdAt : company.updatedAt) - 2000,
                    ...actionTemplate
                });
            });

            if (!offsetObject?.after) {
                hasMore = false;
                break;
            } else if (offsetObject?.after >= 9900) {
                offsetObject.after = 0;
                offsetObject.lastModifiedDate = new Date(data[data.length - 1].updatedAt).valueOf();
            }
        }
        //Should this be abstracted to a parent class? We will always save the domain at the end ?
        this.hubspotController.updateLastPulledDates(this.entity, now);
        await this.hubspotController.saveDomain();
        console.log('process companies');
        this.hubspotController.setOperation('');

        return true;
    }


}


module.exports = {
    HubSpotCompaniesController
}