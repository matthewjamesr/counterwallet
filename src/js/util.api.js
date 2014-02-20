//Inlude a .url param in every jqXHR object -- http://stackoverflow.com/a/11980396
$.ajaxSetup({
    beforeSend: function(jqXHR, settings) {
        jqXHR.url = settings.url;
    }
});

function describeError(jqXHR, textStatus, errorThrown) {
    var message;
    var statusErrorMap = {
        '400' : "Server understood the request but request content was invalid.",
        '401' : "Unauthorised access.",
        '403' : "Forbidden resouce can't be accessed",
        '500' : "Internal Server Error.",
        '503' : "Service Unavailable",
        '525' : "The server is not fully caught up to the blockchain. Please logout try later." //custom
    };
    if (jqXHR && jqXHR.status) {
        message =statusErrorMap[jqXHR.status];
    } else if(textStatus=='parsererror') {
      message = "Error.\nParsing JSON Request failed.";
    } else if(textStatus=='timeout') {
      message = "Request Time out.";
    } else if(textStatus=='abort') {
      message = "Request was aborted by the server";
    //} else if(textStatus.match("^JSON\-RPC Error:")) {
    } else if(errorThrown == "jsonrpc") {
      message = textStatus;
    } else if(errorThrown) {
      message = errorThrown;
    } else {
      message = "Unknown Error.";
    }

    return message;
} 

function defaultErrorHandler(jqXHR, textStatus, errorThrown, endpoint) {
  if(typeof(endpoint)==='undefined') endpoint = jqXHR.url;
  var message = describeError(jqXHR, textStatus, errorThrown);
  bootbox.alert("Error making request to " + endpoint + ": " + message);
}

function _fetchData(url, onSuccess, onError, postdata, extraAJAXOpts, _url_n) {
  /*Makes a simple AJAX request to the specified URL.
    
    -url: The URL to request. May be a single URL, or a list of URLs. If a list of URLs is specified,
     then we attempt the request across the given list of URLs (in order) until we get a success result.
    -onSuccess: A success callback that is passed (data, endpoint), with data being the raw data passed back
    -onError: An error callback that passes the parameters (jqXHR, textStatus, errorThrown, endpoint). If multiple
     URLs were specified, this callback is triggered after the failure for the last URL (i.e. where the
     list is exhausted and we give up)
   */
  var u = null;
  if(typeof(onError)==='undefined' || onError == "default")
    onError = function(jqXHR, textStatus, errorThrown) { return defaultErrorHandler(jqXHR, textStatus, errorThrown, u) };
  if(typeof(postdata)==='undefined') postdata = null;
  if(typeof(extraAJAXOpts)==='undefined') extraAJAXOpts = {};
  if(typeof(_url_n)==='undefined') _url_n = 0;

  //if passed a list of urls for url, then keep trying (via recursion) until we find one that works
  u = url;
  if (url instanceof Array) {
    u = url[_url_n]; // u = url to attempt this time
  }
  
  var ajaxOpts = {
      type: !postdata ? "GET" : "POST",
      data: !postdata ? "" : postdata,
      //dataType: dataType, 
      url: u,
      success: function(res) {
        if(onSuccess) {
          if(extraAJAXOpts && extraAJAXOpts['dataType'] == 'json') {
            if(res.substring) res = $.parseJSON(res); 
            //^ ghetto hack...sometimes jquery does not parse the JSON response (??)  

            if(res && res.hasOwnProperty('result')) {
              onSuccess(res['result'], u);
            } else {
              onError(null, "JSON-RPC Error: "
                + "<p><b>Type:</b> " + res['error']['message'] + "</p>"
                + "<p><b>Code:</b> " + res['error']['code'] + "</p>"
                + "<p><b>Message:</b> " + res['error']['data']['message'] + "</p>"
                /*+ "<p><b>RAW:</b> " + JSON.stringify(res) + "</p>"*/, "jsonrpc", u);
            }
          } else {
            onSuccess(res.responseText, u);
          }
        }
      },
      error:function (jqXHR, opt, err) {
        if (url instanceof Array) {
          if(url.length <= _url_n + 1) {
            //no more urls to hit...finally call error callback (if there is one)
            if (onError) return onError(jqXHR, opt, err, u);
          } else {
            //try the next URL
            return _fetchData(url, onSuccess, onError, postdata, extraAJAXOpts, _url_n + 1);
          }
        } else {
          if (onError) return onError(jqXHR, opt, err, u);
        }
      }
  }
  if(extraAJAXOpts) {
    for (var attrname in extraAJAXOpts) { ajaxOpts[attrname] = extraAJAXOpts[attrname]; }
  }
  $.ajax(ajaxOpts);
}

function _makeJSONAPICall(destType, endpoints, method, params, onSuccess, onError) {
  /*Makes a JSON RPC API call to a specific counterpartyd/counterwalletd endpoint.
   
    -endpoints: The specific API endpoint URL string to make the API request to.
     If a list of endpoint URLs are specified instead of a single URL, then we attempt the request
     across the given list of endpoints (in order) until we get a success result.
    -onSuccess: A success callback that is passed (data, endpoint)
    -onError: An error callback that passes the parameters (jqXHR, textStatus, errorThrown, endpoint). If multiple
     URLs were specified, this callback is triggered after the failure for the last URL (i.e. where the
     list is exhausted and we give up).
   */
  if(typeof(onError)==='undefined')
    onError = function(jqXHR, textStatus, errorThrown, endpoint) {
      return defaultErrorHandler(jqXHR, textStatus, errorThrown, method + "@" + destType)
    };
  
  //make JSON API call to counterwalletd
  if(destType == "counterwalletd") {
    _fetchData(endpoints, onSuccess, onError,
      JSON.stringify({"jsonrpc": "2.0", "id": 0, "method": method, "params": params}),
      { contentType: 'application/json; charset=utf-8',
        dataType:"json",
      }
    );
  } else if(destType == "counterpartyd") {
    //make JSON API call to counterwalletd, which will proxy it to counterpartyd
    _fetchData(endpoints, onSuccess, onError,
      JSON.stringify({
        "jsonrpc": "2.0", "id": 0,
        "method": "proxy_to_counterpartyd",
        "params": {"method": method, "params": params }
      }),
      {
        contentType: 'application/json; charset=utf-8',
        dataType:"json"
      }
    );
  }
}

function _getDestTypeFromMethod(method) {
  //based on the method, determine the endpoints list to use
  var destType = "counterpartyd";
  if(['is_ready', 'get_normalized_balances',
      'get_chat_handle', 'store_chat_handle', 'get_preferences', 'store_preferences',
      'get_raw_transactions', 'get_balance_history', 'get_owned_assets',
      'get_market_price_summary', 'get_market_price_history', 'get_market_info',
      'get_order_book', 'get_trade_history'].indexOf(method) >= 0) {
    destType = "counterwalletd";
  }
  return destType;
}

function _multiAPIPrimative(method, params, onFinished) {
  /*Make request to all servers (parallelized), returning results from all servers into a list.
    (This is a primative and is not normally called directly outside of this module.)
  
    -onFinished: passed the list of server resuls, ordered by the first server to respond, to the last. If a server
     didn't respond, the entry for it is set to null.
  */
  var gatheredResults = [];
  var destType = _getDestTypeFromMethod(method);

  for(var i=0;i < counterwalletd_api_urls.length; i++) {
    //make multiple _makeJSONAPICall calls in parallel, one call for each API endpoint, and collect results...
    _makeJSONAPICall(destType, counterwalletd_api_urls[i], method, params,
    function(data, endpoint) { //success callback
      gatheredResults.push({'success': true, 'endpoint': endpoint, 'data': data});
      
      if(gatheredResults.length == counterwalletd_api_urls.length) {
        onFinished(gatheredResults);
      }
    },
    function(jqXHR, textStatus, errorThrown, endpoint) { //error callback
      gatheredResults.push({'success': false, 'endpoint': endpoint, 'jqXHR': jqXHR, 'textStatus': textStatus, 'errorThrown': errorThrown});
      
      //525 DETECTION (needed here and in failoverAPI() as failoverAPI() doesn't use this primative)
      if(method != "is_ready" && gatheredResults.length == counterwalletd_api_urls.length) {
        //detect a special case of all servers returning code 525, which would mean counterpartyd had a reorg and/or we are upgrading
        var allNotCaughtUp = true;
        for(var j=0;j < gatheredResults.length; j++) {
          if(!gatheredResults['jqXHR'] || gatheredResults['jqXHR'].status != '525') {
            allNotCaughtUp = false;
            break;
          }
        }
        if(allNotCaughtUp) {
          alert("The server(s) are currently updating and/or not caught up to the blockchain. Logging you out. Please try logging in again later.")
          location.reload(false); //log the user out to avoid ruckus
          return;
        }
      }
        
      //otherwise, respond as normal
      onFinished(gatheredResults);  
    });
  }
}

 
/*
 AVAILABLE API CALL METHODS:
 * failoverAPI: Used for all counterpartyd get_ API requests (for now...later we may want to move to multiAPINewest)
 * multiAPI: Used for storing counterwalletd state data (store_preferences, store_chat_handle, etc)
 * multiAPINewest: Used for fetching state data from counterwalletd (e.g. get_preferences, get_chat_handle)
 * multiAPIConsensus: Used for all counterpartyd create_ API requests
*/

function failoverAPI(method, params, onSuccess, onError) {
  /*Make an API call to one or more servers, proceeding sequentially until a success result is returned.
    
    -onSuccess: Called when the first server returns success, and passed the result data as (data, endpoint)
    (where endpoint is the first host that returned success)
    -onError (optional): Called when all servers return error and/or are not available. Passed the last
     non-null error result from a server, passing the parameters (endpoint, jqXHR, textStatus, errorThrown). If not specified,
     will log and display a general error message.
  */
  if(typeof(onError)==='undefined') {
    onError = function(jqXHR, textStatus, errorThrown, endpoint) {
      var message = describeError(jqXHR, textStatus, errorThrown);
      bootbox.alert("failoverAPI: Call failed (failed over across all servers). Method: " + method + "; Last error: " + message);
    };
  }
  //525 DETECTION (needed here and in _multiAPIPrimative) - wrap onError (so that this works even for user supplied onError)
  onErrorOverride = function(jqXHR, textStatus, errorThrown, endpoint) {
    //detect a special case of all servers returning code 525, which would mean counterpartyd had a reorg and/or we are upgrading
    //TODO: this is not perfect in this failover case now because we only see the LAST error. We are currently assuming
    // that if a) the LAST server returned a 525, and b) all servers are erroring out or down, that all servers are
    // probably returning 525s or updating (or messed up somehow) and we should just log the client out to be safe about it.
    // This is probably a good choice for now... 
    if(jqXHR && jqXHR.status == '525') {
      alert("The server(s) are currently updating and/or not caught up to the blockchain. Logging you out. Please try logging in again later. (e:failoverAPI)")
      location.reload(false); //log the user out to avoid ruckus
      return;
    }
    return onError(jqXHR, textStatus, errorThrown, endpoint);
  }

  var destType = _getDestTypeFromMethod(method);
  _makeJSONAPICall(destType, counterwalletd_api_urls, method, params, onSuccess, onErrorOverride);
}
  
function multiAPI(method, params, onSuccess, onError) {
  /*Make an API call across all endpoints, trying to get at least 1 success result.
  
    -onSuccess: Success callback (requires that at least 1 server in the set returned success). Returns the data
     returned from the server to successfully return, as (data, endpoint).
    -onError (optional): Error callback. Called when no servers return success. Returns the error from the last server
     that the call was attempted on, passing the parameters (endpoint, jqXHR, textStatus, errorThrown). If undefined, will log
     to console stating data differences, and pop up error dialog stating that action failed.
  */
  if(typeof(onError)==='undefined') {
    onError = function(jqXHR, textStatus, errorThrown, endpoint) {
      var message = describeError(jqXHR, textStatus, errorThrown);
      bootbox.alert("multiAPI: Parallel call failed (no server returned success). Method: " + method + "; Last error: " + message);
    };
  }

  _multiAPIPrimative(method, params, function(results) {
    //look for the first success and use that...
    for(var i=0; i < results.length; i++) {
      if(results[i]['success']) {
        return onSuccess ? onSuccess(results[i]['data'], results[i]['endpoint']) : true;
      }
    }
    
    //if here, no servers returned success...
    return onError(results[i-1]['jqXHR'], results[i-1]['textStatus'], results[i-1]['errorThrown'], results[i-1]['endpoint']);
  });
}

function multiAPIConsensus(method, params, onSuccess, onConsensusError, onSysError) {
  /*Make an API call and require all servers not returning an error to give back the same result, which is
    passed to the onSuccess callback.
    
    -onSuccess: Success callback (requires that at least 1 server in the set returned success, and
     all successes had data result match up exactly). Args passed are (data, numTotalEndpoints, numConsensusEndpoints)
    -onConsensusError (optional): Error callback. Called if consensus failed. Returns the error data, taking the parameters
     (unmatchingResultsList) (which is a list of the raw unmatching results). If undefined, will log to
     console stating data differences, and pop up error dialog stating that action failed.
    -onSysError (optional): System error callback. Called if all systems were down or returned error. Returns
     the error from the last server that the call was attempted on, passing the parameters (jqXHR, textStatus, errorThrown, endpoint).
  */
  if(typeof(onConsensusError)==='undefined') {
    onConsensusError = function(unmatchingResultsList) {
      bootbox.alert("multiAPIConsensus: Consensus failed. Method: " + method + "; Unmatching results were: " + JSON.stringify(unmatchingResultsList));
    };
  }
  if(typeof(onSysError)==='undefined') {
    onSysError = function(jqXHR, textStatus, errorThrown, endpoint) {
      var message = describeError(jqXHR, textStatus, errorThrown);
      bootbox.alert("multiAPIConsensus: Parallel call failed (no server returned success). Method: " + method + "; Last error: " + message);
    };
  }
 
  _multiAPIPrimative(method, params, function(results) {
    var successResults = [];
    var i = 0;
    for(i=0; i < results.length; i++) {
      if(results[i]['success']) {
        successResults.push(results[i]['data']);
      }
    }
    
    if(!successResults.length) { //no successful results
      return onSysError(results[i-1]['jqXHR'], results[i-1]['textStatus'], results[i-1]['errorThrown'], results[i-1]['endpoint']);
    }
    
    var consensusResult = null;
    for(i=0; i < successResults.length; i++) {
      if(i == 0) {
        consensusResult = successResults[i];
      } else if(successResults[i] != consensusResult) {
        return onConsensusError(successResults); //not all consensus data matches
      }
    }
    
    //if here, all is well
    if(onSuccess) {
      onSuccess(successResults[successResults.length-1], counterwalletd_api_urls.length, successResults.length);
    } 
  });
}

function multiAPINewest(method, params, newestField, onSuccess, onError) {
  /*Make an API call and return the 'newest' data retrieved from the set of servers.

    -newestField: the name of the dict field in the result dict that should be compaired (via regular JS comparison
     operators -- so something like an integer, float, etc)
    -onSuccess: A callback triggered and passed the newest data result from one of the servers as (data, endpoint). The results passed
      have the highest value of the newestField property. Note that if at least one server returned a non-error, but
      ALL servers returned data that was missing the newestField (or at the newestField set to None or blank), then 
      onSuccess IS called, but it is passed (null, null)
    -onError: if ALL servers returned error and we had no successful calls. Returns
     the error from the last server that the call was attempted on, passing the parameters (endpoint, jqXHR, textStatus, errorThrown).
  */
  if(typeof(onError)==='undefined') {
    onError = function(jqXHR, textStatus, errorThrown, endpoint) {
      var message = describeError(jqXHR, textStatus, errorThrown);
      bootbox.alert("multiAPINewest: Parallel call failed (no server returned success). Method: " + method + "; Last error: " + message);
    };
  }
  
  _multiAPIPrimative(method, params, function(results) {
    var successResults = [];
    var i = 0;
    for(i=0; i < results.length; i++) {
      if(results[i]['success']) {
        successResults.push(results[i]);
      }
    }

    if(!successResults.length) { //no successful results
      return onError(results[i-1]['jqXHR'], results[i-1]['textStatus'], results[i-1]['errorThrown'], results[i-1]['endpoint']);
    }
    
    //grab the newest result
    var newest = null;
    for(i=0; i < successResults.length; i++) {
      if(   successResults[i]['data']
         && successResults[i]['data'].hasOwnProperty(newestField)
         && successResults[i]['data'][newestField]
         && (newest == null || successResults[i]['data'][newestField] > successResults[newest]['data'][newestField])) {
        newest = i;
      }
    }
    
    if(onSuccess && newest != null) {
      onSuccess(successResults[newest]['data'], successResults[newest]['endpoint']);
    } else if(onSuccess && newest == null) {
      onSuccess(null, null); //at least one server returned a non-error, but the data was empty
    }
  });
}
