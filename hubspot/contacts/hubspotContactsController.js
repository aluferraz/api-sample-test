const { filterNullValuesFromObject } = require('../../utils');
class HubSpotContactsController {
    hubspotController = null;
    entity = 'contacts';
    constructor(hubspotController) {
        this.hubspotController = hubspotController;
    }
    processContacts = async () => {


        this.hubspotController.setOperation('processContacts');;
        const account = this.hubspotController.getAccount();
        const lastPulledDate = new Date(account.lastPulledDates.contacts);
        const now = new Date();

        let hasMore = true;
        const offsetObject = {};
        const limit = 100;

        while (hasMore) {
            const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
            const lastModifiedDateFilter = this.hubspotController.generateLastModifiedDateFilter(lastModifiedDate, now, 'lastmodifieddate');
            const searchObject = {
                filterGroups: [lastModifiedDateFilter],
                sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
                properties: [
                    'firstname',
                    'lastname',
                    'jobtitle',
                    'email',
                    'hubspotscore',
                    'hs_lead_status',
                    'hs_analytics_source',
                    'hs_latest_source'
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
            const data = searchResult.results || [];

            console.log('fetch contact batch');

            offsetObject.after = parseInt(searchResult.paging?.next?.after);
            const contactIds = data.map(contact => contact.id);

            // contact to company association
            const contactsToAssociate = contactIds;
            const companyAssociationsResults = (await (await this.hubspotController.hubspotClient.apiRequest({
                method: 'post',
                path: '/crm/v3/associations/CONTACTS/COMPANIES/batch/read',
                body: { inputs: contactsToAssociate.map(contactId => ({ id: contactId })) }
            })).json())?.results || [];

            const companyAssociations = Object.fromEntries(companyAssociationsResults.map(a => {
                if (a.from) {
                    contactsToAssociate.splice(contactsToAssociate.indexOf(a.from.id), 1);
                    return [a.from.id, a.to[0].id];
                } else return false;
            }).filter(x => x));

            data.forEach(contact => {
                if (!contact.properties || !contact.properties.email) return;

                const companyId = companyAssociations[contact.id];

                const isCreated = new Date(contact.createdAt) > lastPulledDate;

                const userProperties = {
                    company_id: companyId,
                    contact_name: ((contact.properties.firstname || '') + ' ' + (contact.properties.lastname || '')).trim(),
                    contact_title: contact.properties.jobtitle,
                    contact_source: contact.properties.hs_analytics_source,
                    contact_status: contact.properties.hs_lead_status,
                    contact_score: parseInt(contact.properties.hubspotscore) || 0
                };

                const actionTemplate = {
                    includeInAnalytics: 0,
                    identity: contact.properties.email,
                    userProperties: filterNullValuesFromObject(userProperties)
                };

                this.hubspotController.enqueue({
                    actionName: isCreated ? 'Contact Created' : 'Contact Updated',
                    actionDate: new Date(isCreated ? contact.createdAt : contact.updatedAt),
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
        console.log('process contacts');
        this.hubspotController.setOperation('');
        return true;
    };
}

module.exports = {
    HubSpotContactsController
}