import Ember from 'ember';
import Service from '@ember/service';
import Oidc from 'oidc-client';
import Configuration from 'ember-get-config';
import { computed } from '@ember/object';
import { alias } from '@ember/object/computed';
import { inject as service } from '@ember/service';
import { A } from '@ember/array';

const { OIDC } = Configuration;

export default Service.extend({
  userManager: null,
  isAuthenticated: false,

  applicationName: null,
  applicationURL: null,
  authenticationURL: null,
  requestedScopes: null,
  usePopup: true,
  useInPlaceRedirect: false,
  transitionExceptionList: null,
  transitionToRedirect: null,
  popupRedirectURL: 'popup',
  silentRedirectURL: 'renew',
  responseType: 'id_token token',
  postLogoutRedirectURL: '',
  checkSessionInterval: 30000,
  automaticSilentRenew: false,
  filterProtocolClaims: true,
  loadUserInfo: true,

  localURL: computed(function () {
    return this.get('routing.router.location.location.origin');
  }),

  didAuthenticate() {
    
  },

  init() {
    this._super(...arguments);

    if (!OIDC && !Ember.testing) {
      throw new Error('OIDC Session Service: Missing the OIDC configuration object. Please ' +
        'ensure you have properly declared the `ENV.OIDC` object.');
    }

    if (OIDC && OIDC.enableLogging) {
      /* eslint-disable-next-line no-console */
      console.info('Practical OIDC :: Session Service: Initializing');
    }

    this.transitionExceptionList = [""];

    if (OIDC) {
      this._setEssentialProperties();
      this._setOptionalProperties();
    }

    this._setupUserManager();
  },

  authenticate(transition) {
    let lS = window.localStorage;
    let userMgr = this.get('userManager');
    return userMgr.getUser().then(async data => {
      if (!data || data.expired) {
        var redirectPromise = null;
        if(this.useInPlaceRedirect)
        {
          lS.setItem(`${this.applicationName}-redirectTo`,transition.intent.url || "");
        }

        if(this.usePopup)
        {
          redirectPromise = userMgr.signinPopup();
        } else {
          redirectPromise = userMgr.signinRedirect();
        }
        return await redirectPromise.then(result => {
          this._setSuccessfulAuthenticationState(result);
          if (transition) {
            transition.retry();
          }
          return result;
        }, (error) => {
          this.set('isAuthenticated', false);

          if (error.message === 'Popup window closed' || // Closed the pop up manually
          error.message === 'Error opening popup window') { // Pop-up bloquer closed the windows
            // The popup window was closed, we try and redirect to the specified route
            if (OIDC.failedLoginRoute && typeof OIDC.failedLoginRoute === 'string') {
              if (OIDC.enableLogging) {
                /* eslint-disable-next-line no-console */
                console.info('Practical OIDC :: Session Service: Attempting to redirect the ' +
                  `specified failed login route: ${OIDC.failedLoginRoute}.`);
              }

              this.get('router').transitionTo(OIDC.failedLoginRoute);
            } else {
              /* eslint-disable-next-line no-console */
              console.warn('Practical OIDC :: Session Service: There were no ' +
                '`ENV.OIDC.failedLoginRoute` property specified in the `config/environment.js` ' +
                'file. No automatic redirection will be attempted at this time.');
            }
          } else {
            throw error;
          }
        });
      } else {
        this._setSuccessfulAuthenticationState(data);

        if (transition) {
          transition.retry();
        }
      }
      userMgr.clearStaleState();
      return data;
    });
  },

  router: service('router'),

  userSession: null,
  profile: alias('userSession.profile'),

  roles: computed('profile.role', function () {
    const roles = this.get('profile.role');
    return Array.isArray(roles) ? A(roles) : A([roles]);
  }),

  _setSuccessfulAuthenticationState(userSession) {
    this.setProperties({ isAuthenticated: true, userSession });
    this.get('didAuthenticate')();
  },

  _setEssentialProperties() {
    const isMissingEssentialInformation =
      !OIDC.applicationName ||
      !OIDC.applicationURL ||
      !OIDC.authenticationURL ||
      !OIDC.requestedScopes;

    if (isMissingEssentialInformation) {
      throw new Error('OIDC Session Service: Missing essential information, please ensure you ' +
        'have properly set `ENV.OIDC.applicationName`, `ENV.OIDC.applicationURL`, ' +
        '`ENV.OIDC.authenticationURL`, `ENV.OIDC.requestedScopes` in config.environment.js');
    }

    this.setProperties({
      applicationName: OIDC.applicationName,
      applicationURL: OIDC.applicationURL,
      authenticationURL: OIDC.authenticationURL,
      requestedScopes: OIDC.requestedScopes
    });
  },

  _setOptionalProperties() {
    this._setOptionalProperty('popupRedirectURL', OIDC.popupRedirectURL, 'string');
    this._setOptionalProperty('silentRedirectURL', OIDC.silentRedirectURL, 'string');
    this._setOptionalProperty('responseType', OIDC.responseType, 'string');
    this._setOptionalProperty('postLogoutRedirectURL', OIDC.postLogoutRedirectURL
      || this.get('localURL'), 'string');
    this._setOptionalProperty('checkSessionInterval', OIDC.checkSessionInterval, 'number');
    this._setOptionalProperty('automaticSilentRenew', OIDC.automaticSilentRenew, 'boolean');
    this._setOptionalProperty('filterProtocolClaims', OIDC.filterProtocolClaims, 'boolean');
    this._setOptionalProperty('loadUserInfo', OIDC.loadUserInfo, 'boolean');
    this._setOptionalProperty('transitionToRedirect', OIDC.transitionToRedirect, 'string');
    this._setOptionalProperty('usePopup', OIDC.usePopup, 'boolean');
    this._setOptionalProperty('useInPlaceRedirect', OIDC.useInPlaceRedirect, 'boolean');
    this._setOptionalProperty('transitionExceptionList', OIDC.transitionExceptionList, 'object');

  },

  _setOptionalProperty(propertyName, propertyValue, propertyType) {
    if (propertyValue !== undefined) {
      if (typeof propertyValue === propertyType) {
        this._logOptionalPropertyOverride(propertyName, propertyValue);
        this.set(`${propertyName}`, propertyValue);
      } else {
        this._throwOptionalPropertyError(`ENV.OIDC.${propertyName}`);
      }
    }
  },

  _logOptionalPropertyOverride(propertyName, propertyValue) {
    /* eslint-disable-next-line no-console */
    console.info('Practical OIDC :: Session Service: Overriding the default value for the ' +
      `${propertyName}  to: ${propertyValue}.`);
  },

  _throwOptionalPropertyError(propertyKey) {
    throw new Error('Practical OIDC :: Session Service: Please ensure you have properly set ' +
      `\`${propertyKey}\` in config.environment.js`);
  },

  _setupUserManager() {
    let userManager = new Oidc.UserManager({
      authority: this.get('authenticationURL'),
      client_id: this.get('applicationName'),
      popup_redirect_uri: `${this.get('applicationURL')}/${this.get('popupRedirectURL')}`,
      automaticSilentRenew: this.get('automaticSilentRenew'),
      silent_redirect_uri: `${this.get('applicationURL')}/${this.get('silentRedirectURL')}`,
      checkSessionInterval: this.get('checkSessionInterval'),
      redirect_uri: `${this.get('applicationURL')}/${this.get('popupRedirectURL')}`,
      response_type: this.get('responseType'),
      scope: this.get('requestedScopes'),
      post_logout_redirect_uri: `${this.get('postLogoutRedirectURL')}`,
      filter_protocol_claims: this.get('filterProtocolClaims'),
      loadUserInfo: this.get('loadUserInfo')
    });

    this.set('userManager', userManager);

    userManager.events.addUserLoaded(() => {
      userManager.getUser().then(data => {
        if (data) {
          this.set('isAuthenticated', true);
        }
      });
    });

    $.ajaxSetup({
      beforeSend: async (xhr, settings) => {
        let data = await this.get('userManager').getUser();
        const token = data.access_token;
        if (token && !settings.ignoreAuthorizationHeader) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
      }
    });

  }
});
