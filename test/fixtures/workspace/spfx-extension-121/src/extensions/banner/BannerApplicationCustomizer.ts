import { override } from '@microsoft/decorators';
import { BaseApplicationCustomizer } from '@microsoft/sp-application-base';
import { Dialog } from '@microsoft/sp-dialog';
import { Log } from '@microsoft/sp-core-library';
import { spfi } from '@pnp/sp';
export const parts = [override, BaseApplicationCustomizer, Dialog, Log, spfi];
