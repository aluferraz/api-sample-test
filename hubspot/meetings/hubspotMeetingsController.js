const { filterNullValuesFromObject } = require('../../utils');

class HubSpotMeetingsController {
    hubspotController = null;
    entity = 'meetings';
    constructor(hubspotController) {
        this.hubspotController = hubspotController;
    }
    async processMeetings() {
        this.hubspotController.setOperation('process meetings');;

        const account = this.hubspotController.getAccount();
        const lastPulledDate = new Date(account.lastPulledDates.meetings);
        const now = new Date();

        let hasMore = true;
        const offsetObject = {};
        const limit = 100;

        while (hasMore) {
            const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
            const lastModifiedDateFilter = this.hubspotController.generateLastModifiedDateFilter(lastModifiedDate, now, 'hs_meeting_end_time');
            const searchObject = {
                filterGroups: [lastModifiedDateFilter],
                sorts: [{ propertyName: 'hs_meeting_end_time', direction: 'ASCENDING' }],
                properties: [
                    "hs_timestamp",
                    "hubspot_owner_id",
                    "hs_meeting_title",
                    "hs_meeting_body",
                    "hs_internal_meeting_notes",
                    "hs_meeting_external_url",
                    "hs_meeting_location",
                    "hs_meeting_start_time",
                    "hs_meeting_end_time",
                    "hs_meeting_outcome",
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

            console.log('fetch meetings batch');

            offsetObject.after = parseInt(searchResult.paging?.next?.after);
            const meetingIds = data.map(meeting => meeting.id);

            // meeting to contact association
            //https://developers.hubspot.com/docs/api/crm/associations/v3
            const meetingsToAssociate = meetingIds;
            const meetingAssociationsResults = (await (await this.hubspotController.hubspotClient.apiRequest({
                method: 'post',
                path: '/crm/v3/associations/Meetings/Contacts/batch/read',
                body: { inputs: meetingsToAssociate.map(meetingId => ({ id: meetingId })) }
            })).json())?.results || [];

            const meetingAssociations = Object.fromEntries(meetingAssociationsResults.map(a => {
                if (a.from) {
                    meetingsToAssociate.splice(meetingsToAssociate.indexOf(a.from.id), 1);
                    return [a.from.id, a.to[0].id];
                } else return false;
            }).filter(x => x));

            data.forEach(meeting => {
                //Which property should we use as identity ? assuming hs_meeting_title
                if (!meeting.properties || !meeting.properties.hs_meeting_title) return;

                const contactId = meetingAssociations[meeting.id];

                const isCreated = new Date(meeting.createdAt) > lastPulledDate;

                const meetingProperties = {
                    contact_id: contactId,
                    meeting_body: meeting.properties.hs_meeting_body || '',
                    meeting_end_time: meeting.properties.hs_meeting_end_time,
                    meeting_external_url: meeting.properties.hs_meeting_external_url || '',
                    meeting_location: meeting.properties.hs_meeting_location,
                    meeting_outcome: meeting.properties.hs_meeting_outcome,
                    meeting_start_time: meeting.properties.hs_meeting_start_time,
                    meeting_title: meeting.properties.hs_meeting_title || '',
                };

                const actionTemplate = {
                    includeInAnalytics: 0,
                    identity: meeting.properties.hs_meeting_title,
                    meetingProperties: filterNullValuesFromObject(meetingProperties)
                };

                this.hubspotController.enqueue({
                    actionName: isCreated ? 'meeting Created' : 'meeting Updated',
                    actionDate: new Date(isCreated ? meeting.createdAt : meeting.updatedAt),
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
        console.log('process meetings');
        this.hubspotController.setOperation('');

        return true;
    }


}


module.exports = {
    HubSpotMeetingsController
}