import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version } from '@microsoft/sp-core-library';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import { PropertyPaneTextField } from '@microsoft/sp-property-pane';
import { PropertyFieldListPicker } from '@pnp/spfx-property-controls/lib/PropertyFieldListPicker';
export const parts = [React, ReactDom, Version, BaseClientSideWebPart, PropertyPaneTextField, PropertyFieldListPicker];
