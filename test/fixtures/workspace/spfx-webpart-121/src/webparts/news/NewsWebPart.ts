import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version } from '@microsoft/sp-core-library';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import { PropertyPaneTextField } from '@microsoft/sp-property-pane';
import { SPHttpClient } from '@microsoft/sp-http';
import { spfi } from '@pnp/sp';
import * as strings from 'NewsWebPartStrings';
// import moment from 'moment';  (commented out: must not count as used)
export const parts = [React, ReactDom, Version, BaseClientSideWebPart, PropertyPaneTextField, SPHttpClient, spfi, strings];
export const load = (client: SPHttpClient) => client.get('/_api/web/lists', SPHttpClient.configurations.v1);
